import hre from "hardhat";
import { DummyToken, DummyToken__factory, ExternalCallExecutor, ExternalCallExecutor__factory, MockReceiver, MockReceiver__factory } from "../../typechain-types";
import { deepCopy } from "ethers/lib/utils";
import { TypedEvent } from "../../typechain-types/common";
import { ContractReceipt, ContractFactory, BaseContract } from "@ethersproject/contracts"
import { ERC1967Proxy__factory } from "@debridge-finance/hardhat-debridge/dist/typechain";

export function generateRandomHexString(length: number): string {
    let result = '0x';
    const characters = '0123456789abcdef';
    for (let i = 0; i < length; i++) {
        result += characters[Math.floor(Math.random() * characters.length)];
    }
    return result;
}

/**
 * Deploys a given contract via transparent proxy
 */
export async function deployViaProxy<T extends { initialize: (...params: any) => any }>(factory: ContractFactory, initializationParams: Parameters<T['initialize']>): Promise<T> {
    const implementation = await factory.deploy();
    const proxy = await new ERC1967Proxy__factory(factory.signer).deploy(
        implementation.address,
        factory.interface.encodeFunctionData(
            "initialize",
            initializationParams
        )
    );

    return factory.attach(proxy.address) as any as T
}

/**
 * Deploys a basic ERC-20 contract
 */
export async function deployERC20Token(name: string, decimals: number = 18): Promise<DummyToken> {
    const [deployer] = await hre.ethers.getSigners();

    return await new DummyToken__factory(deployer).deploy(
        name,
        name,
        decimals
    );
}

/**
 * Deploys a ExternalCallExecutor contract
 */
export async function deployExternalCallExecutor(): Promise<ExternalCallExecutor> {
    const [deployer] = await hre.ethers.getSigners();

    return await new ExternalCallExecutor__factory(deployer).deploy();
}

/**
 * Deploys a MockReceiver contract
 */
export async function deployMockReceiver(): Promise<MockReceiver> {
    const [deployer] = await hre.ethers.getSigners();

    return await new MockReceiver__factory(deployer).deploy();
}



/**
 * Finds events of a specific type in a given transaction receipt
 */
export function findEvents<T extends TypedEvent>(contract: BaseContract, eventName: string, txReceipt: ContractReceipt): T[] {
    return txReceipt.logs
        .map((log) => {
            try {
                const logDescription = contract.interface.parseLog(log);
                return {
                    ...log,
                    ...logDescription,
                };
            } catch (e) { }
        })
        .filter((log) => log !== undefined)
        .filter(log => log!.address === contract.address)
        .filter((log) => log!.name === eventName)
        .map((log) => {
            // this is an ugly copypasta from the ethers.js' Contract._wrapEvent method
            // until Contract.queryTransaction() is implemented (https://github.com/ethers-io/ethers.js/discussions/2895)
            const event = deepCopy(log! as unknown) as T;
            event.getBlock = () => contract.provider.getBlock(txReceipt.blockHash);
            event.getTransaction = () => contract.provider.getTransaction(txReceipt.transactionHash);
            event.getTransactionReceipt = () => Promise.resolve(txReceipt);
            return event;
        });
}

/**
 * Finds event of a specific type in a given transaction receipt, or throws an error
 */
export function findEvent<T extends TypedEvent>(contract: BaseContract, eventName: string, txReceipt: ContractReceipt): T {
    const events = findEvents<T>(contract, eventName, txReceipt);
    if (events.length != 1) {
        throw new Error("undetermined behaviour")
    }

    return events[0]
}
