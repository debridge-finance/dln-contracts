import hre, { ethers } from "hardhat";
import "./polyfills"
import { BigNumber, BigNumberish, Bytes, BytesLike } from "ethers";
import { DeBridgeGate } from "@debridge-finance/hardhat-debridge/dist/typechain";
import { DlnDestination, DlnDestination__factory, DlnExternalCallAdapter, DlnExternalCallAdapter__factory, DlnSource, DlnSource__factory, DummyToken__factory, } from "../../typechain-types";
import { deployERC20Token, deployExternalCallExecutor, deployViaProxy, findEvent } from "./common";
import { CreatedOrderEvent, DlnOrderLib } from "../../typechain-types/contracts/DLN/DlnSource";

export type OrderId = string;
export type Order = DlnOrderLib.OrderStruct;

export type OrderData = {
    orderId: OrderId
    order: Order
}

export type LoopbackDln = {
    dlnSource: DlnSource;
    dlnDestination: DlnDestination;
    deBridgeGate: DeBridgeGate
}

type OrderStruct = [
    string,
    BigNumber,
    string,
    BigNumber,
    BigNumber,
    string,
    string,
    string,
    string,
    string,
    string
];

/**
 * Encodes an order
 */
export function encodeOrder(order: Order): Bytes {
    // (uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes)
    return ethers.utils.arrayify(
        ethers.utils.defaultAbiCoder.encode(
            ['(uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes)'],
            [Object.values(order)]
        )
    );
}

/**
 * Decodes an order into an array of data
 */
export function decodeOrder(data: BytesLike): OrderStruct {
    const [repackedOrder] = ethers.utils.defaultAbiCoder.decode(
        ['(uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes)'],
        data
    );

    return repackedOrder
}

export function getRandomValue(min: number, max: number, decimals = 18): BigNumber {
    const denominator = Math.min(decimals, 4);
    min *= 10 ** denominator;
    max *= 10 ** denominator;
    decimals -= denominator;
    const v = Math.floor(Math.random() * (max - min + 1) + min);
    return BigNumber.from("10").pow(decimals).mul(v);
}

/**
 * Deploys and configures a complete loopback setup of DLN (DlnSource + DlnDestination) tied together via the given
 * loopback gate
 */
export async function deployLoopbackDln(gate?: DeBridgeGate): Promise<LoopbackDln> {
    const chainId = await hre.network.provider.send('eth_chainId');
    const [deployer] = await hre.ethers.getSigners();

    const deBridgeGate = gate ?? await hre.deBridge.emulator.deployGate();
    const dlnSource = await deployViaProxy<DlnSource>(new DlnSource__factory(deployer), [
        deBridgeGate.address,
        getRandomValue(0.01, 0.1, 18), // random fee, to prevent rusting
        getRandomValue(2, 10, 0), // random bps, to prevent rusting
        0
    ])
    const dlnDestination = await deployViaProxy<DlnDestination>(new DlnDestination__factory(deployer), [
        deBridgeGate.address,
        0
    ])
  
    await dlnSource.setDlnDestinationAddress(chainId, dlnDestination.address, 1);
    await dlnDestination.setDlnSourceAddress(chainId, dlnSource.address, 1);

    await dlnDestination.setMaxOrderCountsPerBatch(10, 10);

    const externalCallExecutor = await deployExternalCallExecutor();
    const dlnExternalCallAdapter = await deployViaProxy<DlnExternalCallAdapter>(new DlnExternalCallAdapter__factory(deployer), [
        dlnDestination.address,
        externalCallExecutor.address
    ])

    await dlnDestination.setExternalCallAdapter(dlnExternalCallAdapter.address);
    await externalCallExecutor.grantRole(await externalCallExecutor.ADAPTER_ROLE(), dlnExternalCallAdapter.address);
    return { deBridgeGate, dlnSource, dlnDestination };
}

/**
 * Deploys and configures a complete loopback setup of DLN (DlnSource + DlnDestination) tied together via the given
 * loopback gate, and additionally attaches connection to Solana-like addresses
 */
export async function deployDlnWithSolana(solanaChainId: number = 7565164, gate?: DeBridgeGate): Promise<LoopbackDln> {
    const { deBridgeGate, dlnSource, dlnDestination } = await deployLoopbackDln(gate);

    const solanaDlnSource = Buffer.alloc(32, 100);
    const solanaDlnDestination = Buffer.alloc(32, 200);

    await dlnSource.setDlnDestinationAddress(solanaChainId, solanaDlnDestination, /*ChainEngine.Solana*/2);
    await dlnDestination.setDlnSourceAddress(solanaChainId, solanaDlnSource, /*ChainEngine.Solana*/2);
    await dlnDestination.setMaxOrderCountsPerBatch(10, 10);

    await deBridgeGate.setChainSupport(solanaChainId, /*_isSupported*/true, /*_isChainIdFrom*/false);
    await deBridgeGate.setChainSupport(solanaChainId, /*_isSupported*/true, /*_isChainIdFrom*/true);

    return { deBridgeGate, dlnSource, dlnDestination };
}

export async function deployTokens(mintBeneficiary: string) {
    const tokenA = await deployERC20Token("A", 18);
    const tokenB = await deployERC20Token("B", 6);
    const mintAmount = BigNumber.from("1000000").mul(BigNumber.from("10").pow(18));

    await tokenA.mint(mintBeneficiary, mintAmount.toString());
    await tokenB.mint(mintBeneficiary, mintAmount.toString());

    return { tokenA, tokenB }
}

/**
 * Creates an order in the given DlnSource, tracks its creation, and returns the OrderData (id + order) of the order created
 */
export async function createOrder(dlnSource: DlnSource, orderCreation: Parameters<DlnSource['createOrder']>[0], affiliateFee?: BigNumber, affiliateBeneficiary?: string): Promise<CreatedOrderEvent['args']> {
    const affiliateFeeEncoded = (affiliateFee && affiliateBeneficiary) ? hre.ethers.utils.solidityPack(
        ['address', 'uint256'],
        [affiliateBeneficiary, affiliateFee]
    ) : '0x'

    const dlnFee = await dlnSource.globalFixedNativeFee();
    const isNativeGiveToken = ethers.constants.AddressZero.addressEq(await orderCreation.giveTokenAddress);
    const value = dlnFee.add(
        isNativeGiveToken
            ? await orderCreation.giveAmount
            : 0
    );

    if (!isNativeGiveToken) {
        const erc20Contract = new DummyToken__factory(dlnSource.signer).attach(await orderCreation.giveTokenAddress);
        await erc20Contract.increaseAllowance(dlnSource.address, await orderCreation.giveAmount);
    }
    const tx = await dlnSource.createOrder(orderCreation, affiliateFeeEncoded, 0, "0x", { gasLimit: 8000000, value });
    const rcp = await tx.wait();
    const createOrderEvent = findEvent<CreatedOrderEvent>(dlnSource, 'CreatedOrder', rcp);

    return createOrderEvent.args
}

/**
 * Creates and broadcasts a transaction to fulfill the given order, and returns the tx
 */
export async function fulfillOrder(dlnDestination: DlnDestination, order: DlnOrderLib.OrderStruct, unlockAuthority: string): ReturnType<DlnDestination['fulfillOrder']> {
    const isNativeTake = order.takeTokenAddress == ethers.constants.AddressZero;
    const value = isNativeTake
        ? order.takeAmount
        : 0;

    if (!isNativeTake) {
        const erc20Contract = new DummyToken__factory(dlnDestination.signer).attach(order.giveTokenAddress.toString());
        await erc20Contract.increaseAllowance(dlnDestination.address, await order.giveAmount);
    }

    const orderId = await dlnDestination.getOrderId(order);
    return dlnDestination.functions['fulfillOrder((uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes),uint256,bytes32,bytes,address)'](
        order,
        order.takeAmount,
        orderId,
        "0x",
        unlockAuthority,
        {
            value
        }
    );
}

export function packExternalCall(executionFee: number, fallbackAddress: string, safeTxGas: number, executor: string,
    allowDelayedExecution: boolean, requireSuccessfullExecution: boolean, to: string, callData: string) {

    const payload = ethers.utils.defaultAbiCoder.encode([{
        type: "tuple",
        name: "ExternalCallPayload",
        components: [
            { name: "to", type: 'address' },
            { name: "safeTxGas", type: 'uint32' },
            { name: "callData", type: 'bytes' }
        ]
    }],
        [{ to, safeTxGas, callData }]);

    const params = {
        fallbackAddress,
        executor,
        executionFee,
        allowDelayedExecution,
        requireSuccessfullExecution,
        payload
    };

    const packed = ethers.utils.defaultAbiCoder.encode([{
        type: "tuple",
        name: "ExternalCallEnvelopV1",
        components: [
            { name: "fallbackAddress", type: 'address' },
            { name: "executor", type: 'address' },
            { name: "executionFee", type: 'uint160' },
            { name: "allowDelayedExecution", type: 'bool' },
            { name: "requireSuccessfullExecution", type: 'bool' },
            { name: "payload", type: 'bytes' }
        ]
    }],
        [params]);

    // 01 - envelope type
    //                 remove 0x
    return "0x01" + packed.substring(2, packed.length);
}
