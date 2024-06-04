import hre, { ethers, Web3 } from "hardhat";
import "../utils/polyfills"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Suite } from "mocha";
import { createOrder, decodeOrder, deployLoopbackDln, deployTokens, encodeOrder, fulfillOrder, Order, OrderData, OrderId, packExternalCall } from "../utils/dln";
import { DlnOrderLib, DlnDestination } from "../../typechain-types/contracts/DLN/DlnDestination";
import { expect } from "chai";
import { BigNumber, ContractTransaction } from "ethers";
import { fulfillOrderTx, getExpectedOrderIdForOrder, getExpectedTakeOrderState, getExpectedFulfillOrderEventArgs } from "./fulfillOrder.lib";
import { parseEther } from "ethers/lib/utils";
import { deployMockReceiver, findEvent, generateRandomHexString } from "../utils/common";
import { ChainId, Order as OrderUtil } from "@debridge-finance/dln-client";
import { DummyToken, MockReceiver } from "../../typechain-types";

declare module "mocha" {

    interface Context {
        chainId: number;
        dlnDestination: DlnDestination;
        maker: SignerWithAddress;
        receiver: SignerWithAddress;
        taker: SignerWithAddress;
        orderToFulfill: {
            order: DlnOrderLib.OrderStruct,
            fulFillAmount: bigint,
            orderId: string,
            unlockAuthority: string,
            externalCallRewardBeneficiary: string
        },
        fulfillTx: Promise<ContractTransaction>,
        tokenA: DummyToken,
        tokenB: DummyToken,
        mockReceiver: MockReceiver,
        finalReceiverEOA: SignerWithAddress
    }
}

export const testFulfillOrder = (isNativeToken: boolean, withExtCall: boolean) => function (this: Suite) {
    // setup a graph of contracts
    beforeEach('setting up a graph of contracts', async () => {
        const [_deployer, maker, receiver, taker, finalReceiver] = await hre.ethers.getSigners();

        this.ctx.chainId = await hre.network.provider.send('eth_chainId');
        const { dlnDestination } = await deployLoopbackDln()
        const { tokenA, tokenB } = await deployTokens(taker.address);
        this.ctx.dlnDestination = dlnDestination;
        this.ctx.maker = maker;
        this.ctx.finalReceiverEOA = finalReceiver;
        this.ctx.receiver = receiver;
        this.ctx.taker = taker;
        this.ctx.tokenA = tokenA;
        this.ctx.tokenB = tokenB;
        this.ctx.mockReceiver = await deployMockReceiver();
    });

    beforeEach('set order', async () => {
        const takeAmount = BigNumber.from(10).pow(18);
        const takeTokenAddress = isNativeToken ? ethers.constants.AddressZero : this.ctx.tokenB.address;
        const externalCall = withExtCall ? getExternalCall(
            this.ctx.mockReceiver,
            takeTokenAddress,
            takeAmount,
            this.ctx.finalReceiverEOA.address)
            : "0x";
        const orderToFulfill = {
            makerOrderNonce: 0,
            makerSrc: this.ctx.maker.address,
            giveChainId: 1,
            giveTokenAddress: isNativeToken ? ethers.constants.AddressZero : this.ctx.tokenA.address,
            giveAmount: BigNumber.from(1).pow(18),
            takeChainId: this.ctx.chainId,
            takeTokenAddress: takeTokenAddress,
            takeAmount: takeAmount,
            receiverDst: this.ctx.maker.address,
            givePatchAuthoritySrc: this.ctx.maker.address,
            orderAuthorityAddressDst: this.ctx.maker.address,
            allowedTakerDst: "0x",
            allowedCancelBeneficiarySrc: "0x",
            externalCall: externalCall
        };
        this.ctx.orderToFulfill = {
            order: orderToFulfill,
            fulFillAmount: BigInt(takeAmount.toString()),
            orderId: getExpectedOrderIdForOrder(orderToFulfill),
            unlockAuthority: this.ctx.taker.address,
            externalCallRewardBeneficiary: this.ctx.taker.address
        }
    });

    beforeEach('fulfill order', async () => {
        this.ctx.fulfillTx = fulfillOrderTx(this.ctx.dlnDestination.connect(this.ctx.taker),
            this.ctx.orderToFulfill.order,
            this.ctx.orderToFulfill.fulFillAmount,
            this.ctx.orderToFulfill.orderId,
            this.ctx.taker, //taker
        );
    })

    describe('check fulfill order', testOrder);

    function getExternalCall(mockReceiver: MockReceiver, takeTokenAddress: string, takeAmount: BigNumber, receiver: string) {
        const callData = takeTokenAddress == ethers.constants.AddressZero ?
            mockReceiver.interface.encodeFunctionData("receiveETH", [
                receiver
            ])
            :
            mockReceiver.interface.encodeFunctionData("receiveERC20", [
                takeAmount,
                takeTokenAddress,
                receiver
            ])
        return packExternalCall(
            0, //executionFee, 
            receiver, //fallbackAddress, 
            0, //safeTxGas, 
            ethers.constants.AddressZero, //executor
            true, //allowDelayedExecution
            true, //requireSuccessfullExecution
            mockReceiver.address,// to, 
            callData
        );
    }
}

function testOrder(this: Suite) {
    it('must emit event', async () => {
        const eventArgs = await getExpectedFulfillOrderEventArgs(
            this.ctx.orderToFulfill.order,
            this.ctx.orderToFulfill.orderId,
            this.ctx.taker.address, //sender
            this.ctx.taker.address  //unlockAuthority
        );

        await expect(this.ctx.fulfillTx)
            //emit FulfilledOrder(_order, orderId, msg.sender, _unlockAuthority);
            .to.emit(this.ctx.dlnDestination, 'FulfilledOrder')
            .withArgs(
                eventArgs.order,
                eventArgs.orderId,
                eventArgs.sender,
                eventArgs.unlockAuthority);
    });

    it('must correctly save order state', async () => {
        var tx = await this.ctx.fulfillTx;
        const expectedState = await getExpectedTakeOrderState(1, this.ctx.orderToFulfill.order, this.ctx.taker.address);
        expect(await this.ctx.dlnDestination.takeOrders(this.ctx.orderToFulfill.orderId))
            .to.deep.eq(expectedState)
    })

    it('must send funds', async () => {
        const takeAmount = BigNumber.from(this.ctx.orderToFulfill.order.takeAmount);

        const receiver = this.ctx.orderToFulfill.order.externalCall.toString() == "0x"
            ? this.ctx.orderToFulfill.order.receiverDst
            : this.ctx.finalReceiverEOA.address

        if (this.ctx.orderToFulfill.order.takeTokenAddress == ethers.constants.AddressZero) {
            await expect(this.ctx.fulfillTx)
                .to.changeEtherBalances(
                    [this.ctx.taker, receiver],
                    [takeAmount.mul(-1), takeAmount]
                );
        }
        else {
            await expect(this.ctx.fulfillTx)
                .to.changeTokenBalances(
                    this.ctx.tokenB,
                    [this.ctx.taker, receiver],
                    [takeAmount.mul(-1), takeAmount]
                );
        }

    });
}



