import hre, { ethers } from "hardhat";
import { DeBridgeGate } from "@debridge-finance/hardhat-debridge/dist/typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DlnDestination } from "../../typechain-types";
import { Suite } from "mocha";
import { decodeOrder, deployLoopbackDln, encodeOrder, fulfillOrder, Order } from "../utils/dln";
import { DlnSource } from "../../typechain-types/contracts/DLN/DlnSource";
import { expect } from "chai";


declare module "mocha" {
    interface Context {
        takeChainId: number;
        deBridgeGate: DeBridgeGate;
        dlnSource: DlnSource;
        dlnDestination: DlnDestination;
        taker1: SignerWithAddress;
        taker2: SignerWithAddress;
        receiver: SignerWithAddress;
        order: Order;
    }
}

export const testAllowedTakerDst = () => function (this: Suite) {
    // setup graph of contracts
    beforeEach('setting up a graph of contracts', async () => {
        const [_deployer, taker1, taker2, receiver] = await hre.ethers.getSigners();

        this.ctx.takeChainId = await hre.network.provider.send('eth_chainId');
        const { deBridgeGate, dlnSource, dlnDestination } = await deployLoopbackDln()
        this.ctx.deBridgeGate = deBridgeGate;
        this.ctx.dlnSource = dlnSource;
        this.ctx.dlnDestination = dlnDestination

        this.ctx.taker1 = taker1;
        this.ctx.taker2 = taker2;
        this.ctx.receiver = receiver;

        this.ctx.order = {
            makerOrderNonce: 0,
            makerSrc: Buffer.alloc(20, 1), // dummy maker address, doesn't matter
            giveChainId: this.ctx.takeChainId,
            giveTokenAddress: ethers.constants.AddressZero,
            giveAmount: 0,
            takeChainId: this.ctx.takeChainId,
            takeTokenAddress: ethers.constants.AddressZero,
            takeAmount: 1,
            receiverDst: this.ctx.receiver.address,
            givePatchAuthoritySrc: this.ctx.receiver.address,
            orderAuthorityAddressDst: this.ctx.receiver.address,
            allowedTakerDst: Buffer.alloc(0),
            allowedCancelBeneficiarySrc: Buffer.alloc(0),
            externalCall: Buffer.alloc(0)
        }
    });

    it("should fulfill the order without allowedTakerDst", async () => {
        const order: Order = {
            ...this.ctx.order,
            allowedTakerDst: Buffer.alloc(0)
        }
        const orderId = await this.ctx.dlnDestination.getOrderId(order);
        const tx = fulfillOrder(this.ctx.dlnDestination.connect(this.ctx.taker1), this.ctx.order, this.ctx.taker2.address)
        await expect(tx)
            .to.emit(this.ctx.dlnDestination, 'FulfilledOrder')
            .withArgs(decodeOrder(encodeOrder(order)), orderId, this.ctx.taker1.address, this.ctx.taker2.address)

        expect((await this.ctx.dlnDestination.takeOrders(orderId)).status)
            .to.eq(/*Status.Fulfilled*/1);
    })

    it("should fulfill the order with the given allowedTakerDst equals to supplied unlockAuthority", async () => {
        const order: Order = {
            ...this.ctx.order,
            allowedTakerDst: this.ctx.taker2.address
        }
        const orderId = await this.ctx.dlnDestination.getOrderId(order);
        const tx = fulfillOrder(this.ctx.dlnDestination.connect(this.ctx.taker2), order, this.ctx.taker2.address)
        await expect(tx)
            .to.emit(this.ctx.dlnDestination, 'FulfilledOrder')
            .withArgs(decodeOrder(encodeOrder(order)), orderId, this.ctx.taker2.address, this.ctx.taker2.address)

        expect((await this.ctx.dlnDestination.takeOrders(orderId)).status)
            .to.eq(/*Status.Fulfilled*/1);
    })

    it("should not fulfill the order with the given allowedTakerDst that does not match supplied unlockAuthority", async () => {
        const order: Order = {
            ...this.ctx.order,
            allowedTakerDst: this.ctx.taker2.address // <!-- allowedTaker=taker2, but unlockAuthority is set to taker1
        }
        const orderId = await this.ctx.dlnDestination.getOrderId(order);
        const tx = fulfillOrder(this.ctx.dlnDestination.connect(this.ctx.taker2), order, this.ctx.taker1.address)
        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'Unauthorized')

        // order should not have been fulfilled
        expect((await this.ctx.dlnDestination.takeOrders(orderId)).status)
            .to.eq(/*Status.NotSet*/0);
    })
}