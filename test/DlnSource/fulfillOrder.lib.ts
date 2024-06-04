import hre, { ethers } from "hardhat";
import "../utils/polyfills"
import { ChainId, Order as OrderUtil } from "@debridge-finance/dln-client";
import { DummyToken__factory } from "../../typechain-types";
import { Order, OrderId } from "../utils/dln";
import { DlnDestination, DlnOrderLib } from "../../typechain-types/contracts/DLN/DlnDestination";
import { BigNumber, ContractTransaction } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export function getExpectedOrderIdForOrder(order: Order): OrderId {
    const takeChainId: ChainId = BigNumber.from(order.takeChainId).toNumber();
    const giveChainId = BigNumber.from(order.giveChainId).toNumber();
    return OrderUtil.calculateId({
        nonce: BigInt(BigNumber.from(order.makerOrderNonce).toString()),
        maker: order.makerSrc.toString().toBuffer(giveChainId),
        give: {
            tokenAddress: order.giveTokenAddress.toString().toBuffer(giveChainId),
            chainId: giveChainId,
            amount: BigInt(BigNumber.from(order.giveAmount).toString())
        },
        take: {
            tokenAddress: order.takeTokenAddress.toString().toBuffer(takeChainId),
            chainId: BigNumber.from(order.takeChainId).toNumber(),
            amount: BigInt(BigNumber.from(order.takeAmount).toString())
        },
        receiver: order.receiverDst.toString().toBuffer(takeChainId),
        givePatchAuthority: order.givePatchAuthoritySrc.toString().toBuffer(takeChainId),
        orderAuthorityDstAddress: order.orderAuthorityAddressDst.toString().toBuffer(takeChainId),
        externalCall: order.externalCall.toString() != "0x" ?
            {
                externalCallData: order.externalCall.toString().toBuffer(1)
            }
            : undefined
    });
}

type TakeOrderState = Awaited<ReturnType<DlnDestination['takeOrders']>>

export async function fulfillOrderTx(dlnDestination: DlnDestination, order: DlnOrderLib.OrderStruct,
    fulFillAmount: bigint, orderId: string, taker: SignerWithAddress): Promise<ContractTransaction> {
    const isNativeGiveToken = ethers.constants.AddressZero.addressEq(await order.takeTokenAddress.toString());
    const value = isNativeGiveToken
        ? await order.takeAmount
        : 0;

    if (!isNativeGiveToken) {
        const erc20Contract = new DummyToken__factory(dlnDestination.signer).attach(await order.takeTokenAddress.toString());
        await erc20Contract.connect(taker)
            .increaseAllowance(dlnDestination.address, fulFillAmount);
    }

    // function fulfillOrder(
    //     DlnOrderLib.Order memory _order,
    //     uint256 _fulFillAmount,
    //     bytes32 _orderId,
    //     bytes calldata _permitEnvelope,
    //     address _unlockAuthority,
    //     address _externalCallRewardBeneficiary
    // )
    return dlnDestination.connect(taker)["fulfillOrder((uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes),uint256,bytes32,bytes,address,address)"]
        (order, fulFillAmount, orderId, "0x", taker.address, taker.address, { gasLimit: 8_000_000, value: value });
}

export async function getExpectedTakeOrderState(status: number, order: Order, taker: string): Promise<TakeOrderState> {
    // struct OrderTakeState {
    //     OrderTakeStatus status;
    //     address takerAddress;
    //     // use giveChainId it chainId less then uint32 max
    //     uint32 giveChainId;
    //     // use bigGiveChainId it chainId more then uint32 max
    //     uint256 bigGiveChainId;
    // }
    const state = {
        status,
        takerAddress: taker,
        giveChainId: BigNumber.from(order.giveChainId),
        bigGiveChainId: 0
    }
    return <TakeOrderState>Object.assign(Object.values(state), state);
}

export async function getExpectedFulfillOrderEventArgs(
    order: Awaited<DlnOrderLib.OrderStruct>,
    orderId: string,
    sender: string,
    unlockAuthority: string)
    : Promise<any> {
    // : Promise<FulfilledOrderEventObject> {

    // Convert all addresses to lowercase for consistency in comparison
    const expectedOrder =
        <DlnOrderLib.OrderStructOutput>Object.assign(
            Object.values(order), order
        ).map(item =>
            typeof item === 'string' && item.startsWith('0x') ? item.toLowerCase() : item
        );
    return {
        order: expectedOrder,
        orderId: orderId,
        sender: sender,
        unlockAuthority: unlockAuthority
    };
}