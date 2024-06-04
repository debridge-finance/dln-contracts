import hre, { ethers } from "hardhat";
import "../utils/polyfills"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Suite } from "mocha";
import { createOrder, decodeOrder, deployLoopbackDln, encodeOrder, fulfillOrder, Order, OrderData, OrderId } from "../utils/dln";
import { CreatedOrderEvent, CreatedOrderEventObject, DlnOrderLib, DlnSource } from "../../typechain-types/contracts/DLN/DlnSource";
import { expect } from "chai";
import { BigNumber, ContractTransaction } from "ethers";
import { createOrderTx, createSaltedOrderTx, getExpectedCreatedOrderEventArgs, getExpectedOrder, getExpectedOrderId, getExpectedOrderState } from "./createOrder.lib";
import { parseEther } from "ethers/lib/utils";
import { findEvent, generateRandomHexString } from "../utils/common";

declare module "mocha" {
    interface Context {
        chainId: number;
        dlnSource: DlnSource;
        maker: SignerWithAddress;
        receiver: SignerWithAddress;

        orderData: {
            orderCreation: DlnOrderLib.OrderCreationStruct,
            salt: bigint,
            referralCode: number,
            affiliate?: {
                affiliateFeeAmount: bigint,
                affiliateFeeBeneficiary: string,
            },
            payload?: string,
        },
        creationTx: Promise<ContractTransaction>
    }
}

export const testCreateOrder = () => function (this: Suite) {
    // setup a graph of contracts
    beforeEach('setting up a graph of contracts', async () => {
        const [_deployer, maker, receiver] = await hre.ethers.getSigners();

        this.ctx.chainId = await hre.network.provider.send('eth_chainId');
        const { dlnSource } = await deployLoopbackDln()
        this.ctx.dlnSource = dlnSource;
        this.ctx.maker = maker;
        this.ctx.receiver = receiver;
    });

    beforeEach('set order', async () => {
        this.ctx.orderData = {
            orderCreation: {
                giveTokenAddress: ethers.constants.AddressZero,
                giveAmount: BigNumber.from(10).pow(18),
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                takeChainId: this.ctx.chainId,
                receiverDst: this.ctx.receiver.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.receiver.address,
                allowedTakerDst: "0x",
                externalCall: "0x",
                allowedCancelBeneficiarySrc: "0x"
            },
            salt: (await this.ctx.dlnSource.masterNonce(this.ctx.maker.address)).toBigInt(),
            referralCode: 0,
            affiliate: undefined,
            payload: undefined
        }
    });

    beforeEach('create order', async () => {
        const { orderCreation, affiliate, referralCode } = this.ctx.orderData;
        this.ctx.creationTx = createOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode);
    })

    describe('check order', testOrder);

    it('salted order with reused nonce must revert', async () => {
        // trying to create the same salted order (with the same nonce)
        const { orderCreation, affiliate, referralCode } = this.ctx.orderData;
        const tx = createSaltedOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, this.ctx.orderData.salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode);
        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnSource, 'IncorrectOrderStatus')
    })
}


export const testCreateSaltedOrder = (referralCode?: number, useAffiliateFee?: boolean) => function (this: Suite) {
    // setup a graph of contracts
    before('setting up a graph of contracts', async () => {
        const [_deployer, maker, receiver] = await hre.ethers.getSigners();

        this.ctx.chainId = await hre.network.provider.send('eth_chainId');
        const { dlnSource } = await deployLoopbackDln()
        this.ctx.dlnSource = dlnSource;
        this.ctx.maker = maker;
        this.ctx.receiver = receiver;
    });

    before('set order', async () => {
        this.ctx.orderData = {
            orderCreation: {
                giveTokenAddress: ethers.constants.AddressZero,
                giveAmount: parseEther("1"),
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                takeChainId: this.ctx.chainId,
                receiverDst: this.ctx.receiver.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.receiver.address,
                allowedTakerDst: "0x",
                externalCall: "0x",
                allowedCancelBeneficiarySrc: "0x"
            },
            salt: (await this.ctx.dlnSource.masterNonce(this.ctx.maker.address)).toBigInt(),
            referralCode: referralCode || 0,
            affiliate: useAffiliateFee ? {
                affiliateFeeAmount: parseEther("0.1").toBigInt(),
                affiliateFeeBeneficiary: this.ctx.maker.address
            } : undefined,
            payload: generateRandomHexString(500),
        }
    });

    before('create order', async () => {
        const { orderCreation, affiliate, referralCode, payload } = this.ctx.orderData;
        this.ctx.creationTx = createSaltedOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, this.ctx.orderData.salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode, undefined, payload);
    })

    describe('check salted order', testOrder)

    describe('check order uniqueness', function () {
        it('salted order with reused salt must revert', async () => {
            // trying to create the same salted order (with the same nonce)
            const { orderCreation, affiliate, referralCode, payload } = this.ctx.orderData;
            const tx = createSaltedOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, this.ctx.orderData.salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode, payload);
            await expect(tx)
                .to.revertedWithCustomError(this.ctx.dlnSource, 'IncorrectOrderStatus')
        })
    })

    describe('check new order with same salt and incremented giveAmount', async () => {
        before('create order', async () => {
            const { orderCreation, affiliate, referralCode, payload } = this.ctx.orderData;
            // increment giveAmount, which affects orderId
            // do not increment by 1 wei (0.000000000000000001) because this causes discrepancy between on-chain
            // and off-chain calculations: giveAmount=999100000000000001 gives percentFee=900000000000000 when calculated
            // on-chain and gives percentFee=899999999999999 when calculated off-chain
            orderCreation.giveAmount = BigNumber.from(orderCreation.giveAmount)
                .add(parseEther("0.01"))
            this.ctx.creationTx = createSaltedOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, this.ctx.orderData.salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode, undefined, payload);
        })

        describe('should correctly create new salted order', testOrder)
    })

    describe('check new order with same salt and incremented takeAmount', async () => {
        before('create order', async () => {
            const { orderCreation, affiliate, referralCode, payload } = this.ctx.orderData;
            // increment takeAmount, which affects orderId
            orderCreation.takeAmount = BigNumber.from(orderCreation.takeAmount).add(1)
            this.ctx.creationTx = createSaltedOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, this.ctx.orderData.salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode, undefined, payload);
        })

        describe('should correctly create new salted order', testOrder)
    })

    describe('check new order with incremented salt', async () => {
        before('create order', async () => {
            const { orderCreation, affiliate, referralCode, payload } = this.ctx.orderData;
            this.ctx.orderData.salt++;
            this.ctx.creationTx = createSaltedOrderTx(this.ctx.dlnSource.connect(this.ctx.maker), orderCreation, this.ctx.orderData.salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode, undefined, payload);
        })

        describe('should correctly create new salted order', testOrder)
    })
}

function testOrder(this: Suite) {
    it('must emit event', async () => {
        const { orderCreation, salt, affiliate, referralCode, payload } = this.ctx.orderData;
        const eventArgs = await getExpectedCreatedOrderEventArgs(this.ctx.dlnSource, this.ctx.maker.address, this.ctx.chainId, orderCreation, salt, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary, referralCode, payload);
        await expect(this.ctx.creationTx)
            .to.emit(this.ctx.dlnSource, 'CreatedOrder')
            .withArgs(eventArgs.order, eventArgs.orderId, eventArgs.affiliateFee, eventArgs.nativeFixFee, eventArgs.percentFee, referralCode, payload || '0x');
    });

    it('must correctly save order state', async () => {
        await this.ctx.creationTx;

        const { orderCreation, salt, affiliate } = this.ctx.orderData;
        const order = await getExpectedOrder(this.ctx.dlnSource, this.ctx.maker.address, this.ctx.chainId, orderCreation, salt, affiliate?.affiliateFeeAmount);
        const orderId = getExpectedOrderId(this.ctx.maker.address, this.ctx.chainId, order, salt);
        const expectedState = await getExpectedOrderState(1, this.ctx.dlnSource, order, affiliate?.affiliateFeeAmount, affiliate?.affiliateFeeBeneficiary)
        expect(await this.ctx.dlnSource.giveOrders(orderId))
            .to.deep.eq(expectedState)
    })

    it('must lock funds (native)', async () => {
        let nativeAmount = await this.ctx.dlnSource.globalFixedNativeFee();
        if (this.ctx.orderData.orderCreation.giveTokenAddress === ethers.constants.AddressZero) {
            nativeAmount = BigNumber.from(this.ctx.orderData.orderCreation.giveAmount)
                .add(nativeAmount);
        }

        await expect(this.ctx.creationTx)
            .to.changeEtherBalances(
                [this.ctx.maker, this.ctx.dlnSource],
                [nativeAmount.mul(-1), nativeAmount]
            );
    })

    it('must lock funds (erc-20)', async () => {
        if (this.ctx.orderData.orderCreation.giveTokenAddress === ethers.constants.AddressZero) {
            this.ctx.skip();
        }

        expect(false, 'this test case must be implemented');
    })
}