import hre, { ethers } from "hardhat";
import "../utils/polyfills"
import { ChainId, Order as OrderUtil } from "@debridge-finance/dln-client";
import { DummyToken__factory } from "../../typechain-types";
import { Order, OrderId } from "../utils/dln";
import { CreatedOrderEventObject, DlnOrderLib, DlnSource } from "../../typechain-types/contracts/DLN/DlnSource";
import { BigNumber, ContractTransaction } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export function getExpectedOrderId(makerSrc: string, giveChainId: ChainId, order: Order, saltOrNonce: bigint): OrderId {
    const takeChainId: ChainId = BigNumber.from(order.takeChainId).toNumber();

    return OrderUtil.calculateId({
        nonce: saltOrNonce,
        maker: makerSrc.toString().toBuffer(giveChainId),
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


type GiveOrderState = Awaited<ReturnType<DlnSource['giveOrders']>>

export async function getExpectedOrderState(status: number, dlnSource: DlnSource, order: Order, affiliateFeeAmount?: bigint, affiliateBeneficiary?: string): Promise<GiveOrderState> {
    // amount before clearance
    const initialGiveAmount = getInitialGiveAmount(BigNumber.from(order.giveAmount), await dlnSource.globalTransferFeeBps(), affiliateFeeAmount);
    const percentFee = getPercentFee(initialGiveAmount, BigNumber.from(order.giveAmount), affiliateFeeAmount);

    const state = {
        status,
        giveTokenAddress: BigNumber.from(order.giveTokenAddress),
        nativeFixFee: await dlnSource.globalFixedNativeFee(),
        takeChainId: BigNumber.from(order.takeChainId).toNumber(),
        percentFee,
        giveAmount: BigNumber.from(order.giveAmount),
        affiliateBeneficiary: affiliateBeneficiary || ethers.constants.AddressZero,
        affiliateAmount: BigNumber.from(affiliateFeeAmount || 0)
    }
    return <GiveOrderState>Object.assign(Object.values(state), state);
}

function getInitialGiveAmount(clearedGiveAmount: BigNumber, feeBps: number, affiliateFeeAmount?: bigint): BigNumber {
    // get uncleared (before fee cut) giveAmount, so we can calculate percentFee property
    return BigNumber.from(clearedGiveAmount)
        .add(affiliateFeeAmount || 0)
        .div(10_000 - feeBps)
        .mul(10_000)
}

function getPercentFee(initialGiveAmount: BigNumber, giveAmount: BigNumber, affiliateFeeAmount?: bigint): BigNumber {
    const fee = BigNumber.from(initialGiveAmount)
        .sub(giveAmount)
        .sub(affiliateFeeAmount || 0);
    if (fee.lt(0)) return BigNumber.from(0);
    return fee;
}

export async function getExpectedOrder(dlnSource: DlnSource, makerSrc: string, giveChainId: ChainId, orderCreation: Awaited<DlnOrderLib.OrderCreationStruct>, saltOrNonce: bigint, affiliateFeeAmount?: bigint): Promise<Awaited<Order>> {
    // smart contract source code:
    // uint256 percentFee = (globalTransferFeeBps * _order.giveAmount) / BPS_DENOMINATOR;
    // _order.giveAmount -= percentFee + affiliateAmount;
    const transferFee = BigNumber.from(await dlnSource.globalTransferFeeBps()).toBigInt()
    const percentFee = (transferFee * BigNumber.from(orderCreation.giveAmount).toBigInt()) / 10_000n;
    const clearedGiveAmount = BigNumber.from(orderCreation.giveAmount).toBigInt() - (percentFee + (affiliateFeeAmount || 0n));

    return {
        makerOrderNonce: saltOrNonce,
        makerSrc: makerSrc.toLowerCase(),
        giveChainId,
        giveTokenAddress: orderCreation.giveTokenAddress,
        giveAmount: clearedGiveAmount,
        takeChainId: orderCreation.takeChainId,
        takeTokenAddress: orderCreation.takeTokenAddress,
        takeAmount: orderCreation.takeAmount,
        receiverDst: orderCreation.receiverDst.toString().toLowerCase(),
        givePatchAuthoritySrc: orderCreation.givePatchAuthoritySrc.toString().toLowerCase(),
        orderAuthorityAddressDst: orderCreation.orderAuthorityAddressDst.toString().toLowerCase(),
        allowedTakerDst: orderCreation.allowedTakerDst.toString().toLowerCase(),
        allowedCancelBeneficiarySrc: orderCreation.allowedCancelBeneficiarySrc.toString().toLowerCase(),
        externalCall: orderCreation.externalCall
    }
}

export function encodeAffiliateFee(affiliateFeeAmount?: bigint, affiliateBeneficiary?: string): string {
    return (affiliateFeeAmount && affiliateBeneficiary) ? hre.ethers.utils.solidityPack(
        ['address', 'uint256'],
        [affiliateBeneficiary, affiliateFeeAmount]
    ) : '0x';
}

export async function getExpectedCreatedOrderEventArgs(dlnSource: DlnSource, makerSrc: string, giveChainId: ChainId, orderCreation: Awaited<DlnOrderLib.OrderCreationStruct>, saltOrNonce: bigint, affiliateFeeAmount?: bigint, affiliateBeneficiary?: string, referralCode?: number, payload?: string): Promise<CreatedOrderEventObject> {
    const order = await getExpectedOrder(dlnSource, makerSrc, giveChainId, orderCreation, saltOrNonce, affiliateFeeAmount,);

    return {
        order: <DlnOrderLib.OrderStructOutput>Object.assign(
            Object.values(order), order
        ),
        orderId: getExpectedOrderId(makerSrc, giveChainId, order, saltOrNonce),
        affiliateFee: encodeAffiliateFee(affiliateFeeAmount, affiliateBeneficiary),
        nativeFixFee: await dlnSource.globalFixedNativeFee(),
        percentFee: getPercentFee(BigNumber.from(orderCreation.giveAmount), BigNumber.from(order.giveAmount), affiliateFeeAmount),
        referralCode: referralCode || 0,
        payload: payload || '0x'
    }
}

export async function createOrderTx(dlnSource: DlnSource, orderCreation: DlnOrderLib.OrderCreationStruct, affiliateFeeAmount?: bigint, affiliateBeneficiary?: string, referralCode?: number, permitEnvelope?: string): Promise<ContractTransaction> {
    const nativeFixFee = await dlnSource.globalFixedNativeFee();
    const isNativeGiveToken = ethers.constants.AddressZero.addressEq(await orderCreation.giveTokenAddress);
    const value = nativeFixFee.add(
        isNativeGiveToken
            ? await orderCreation.giveAmount
            : 0
    );

    if (!isNativeGiveToken) {
        const erc20Contract = new DummyToken__factory(dlnSource.signer).attach(await orderCreation.giveTokenAddress);
        await erc20Contract.increaseAllowance(dlnSource.address, await orderCreation.giveAmount);
    }

    return dlnSource.createOrder(orderCreation, encodeAffiliateFee(affiliateFeeAmount, affiliateBeneficiary), referralCode || 0, permitEnvelope || '0x', { gasLimit: 8_000_000, value });
}


export async function createSaltedOrderTx(dlnSource: DlnSource, orderCreation: DlnOrderLib.OrderCreationStruct, salt: bigint, affiliateFeeAmount?: bigint, affiliateBeneficiary?: string, referralCode?: number, permitEnvelope?: string, payload?: string): Promise<ContractTransaction> {
    const nativeFixFee = await dlnSource.globalFixedNativeFee();
    const isNativeGiveToken = ethers.constants.AddressZero.addressEq(await orderCreation.giveTokenAddress);
    const value = nativeFixFee.add(
        isNativeGiveToken
            ? await orderCreation.giveAmount
            : 0
    );

    if (!isNativeGiveToken) {
        const erc20Contract = new DummyToken__factory(dlnSource.signer).attach(await orderCreation.giveTokenAddress);
        await erc20Contract.increaseAllowance(dlnSource.address, await orderCreation.giveAmount);
    }

    return dlnSource.createSaltedOrder(orderCreation, salt, encodeAffiliateFee(affiliateFeeAmount, affiliateBeneficiary), referralCode || 0, permitEnvelope || '0x', payload || '0x', { gasLimit: 8_000_000, value });
}