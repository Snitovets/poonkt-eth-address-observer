/* 
eth-address-observer is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

eth-address-observer is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with eth-address-observer.  If not, see <https://www.gnu.org/licenses/>.
*/
/**
 * @file eth-addresses-observer.ts
 * @author Vitaly Snitovets <v.snitovets@gmail.com>
 * @date 2021
 */

import Web3 from "web3";
import { AddressesObserver, AddressesObserverConfig } from "../addresses-observer";
import { ERC20TransactionsCollector, ERC20Transfer } from "./erc20-transactions-collector";
import { EthBlocksCollector } from "./eth-blocks-collector";
import { EthTransactionsCollector } from "./eth-transactions-collector";
import { TransactionsManager } from "./transactions-manager";

export interface EthAddressesObserverConfig extends Partial<AddressesObserverConfig> {
	erc20?: {
		confirmationsRequired?: number;
		cacheSize?: number;
	};
}

export type SubscriptionType =
	| "pending"
	| "confirmation"
	| "success"
	| "transfer-pending"
	| "transfer-confirmation"
	| "transfer-success";
export class EthAddressesObserver extends AddressesObserver {
	private readonly web3: Web3;

	ethBlocksCollector: EthBlocksCollector;

	ethTransactionsCollector: EthTransactionsCollector;
	ethTransactionsManager: TransactionsManager;

	erc20TransactionsCollector: ERC20TransactionsCollector;
	erc20TransactionsManager: TransactionsManager;

	constructor(web3: Web3, config: EthAddressesObserverConfig = { erc20: {} }) {
		config.confirmationsRequired = config.confirmationsRequired || 12;

		config.erc20.confirmationsRequired = config.erc20.confirmationsRequired || 12;
		config.erc20.cacheSize = config.erc20.cacheSize || 512;

		super(config as AddressesObserverConfig);

		this.web3 = web3;

		this.ethBlocksCollector = new EthBlocksCollector(web3, config.blocksCacheSize);

		this.ethTransactionsCollector = new EthTransactionsCollector(this.watchList);
		this.ethTransactionsManager = new TransactionsManager(web3, config.confirmationsRequired);

		this.erc20TransactionsCollector = new ERC20TransactionsCollector(web3, config.erc20.cacheSize, this.watchList);
		this.erc20TransactionsManager = new TransactionsManager(web3, config.erc20.confirmationsRequired);

		this.ethBlocksCollector.on("new-block", (latestBlockNumber: number) => {
			this.process(latestBlockNumber);
		});
		this.ethTransactionsCollector.on("new-transaction", (transactionHash: string) => {
			this.addTransaction(transactionHash);
		});
		this.erc20TransactionsCollector.on("new-transfer", (transfer: ERC20Transfer) => {
			this.addErc20Transfer(transfer);
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	subscribe(type: SubscriptionType, handler: (...args: any[]) => void): void {
		const str = type.split("-");

		if (str[0] === "transfer") {
			this.erc20TransactionsManager.on(str[1], handler);
		} else {
			this.ethTransactionsManager.on(type, handler);
		}
	}

	toBigInt(address: string): bigint {
		return BigInt(address);
	}

	toAddress(number: bigint): string {
		const hex = number.toString(16);
		const address =
			"0x" +
			Array(40 - hex.length)
				.fill(0)
				.join("") +
			hex;

		return address;
	}

	private async process(blockNumber: number) {
		try {
			const { transactions } = await this.web3.eth.getBlock(blockNumber, true);
			this.ethTransactionsCollector.add(transactions);
			this.ethTransactionsManager.process(blockNumber);
			this.erc20TransactionsManager.process(blockNumber);
		} catch (error) {
			this.process(blockNumber);
		}
	}

	private async addTransaction(transactionHash: string) {
		try {
			await this.ethTransactionsManager.add(transactionHash);
		} catch (error) {
			this.addTransaction(transactionHash);
		}
	}

	private async addErc20Transfer(transfer: ERC20Transfer) {
		try {
			await this.erc20TransactionsManager.add(transfer.log.transactionHash, transfer);
		} catch (error) {
			this.addErc20Transfer(transfer);
		}
	}
}
