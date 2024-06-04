import hre, { ethers } from "hardhat";
import { DeBridgeGate } from "@debridge-finance/hardhat-debridge/dist/typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { CallProxy, DlnDestination, MockCallProxy, MockCallProxy__factory } from "../../typechain-types";
import { Suite } from "mocha";
import { createOrder, decodeOrder, deployLoopbackDln, encodeOrder, fulfillOrder, Order, OrderData, OrderId } from "../utils/dln";
import { ClaimedUnlockEvent, DlnSource } from "../../typechain-types/contracts/DLN/DlnSource";
import { expect } from "chai";
import { claimSubmission } from "../utils/deBridge";
import { CallProxy__factory } from "@debridge-finance/desdk/lib/evm/typechain";
import { BigNumber, ContractTransaction } from "ethers";
import { findEvents } from "../utils/common";
import { evm } from "@debridge-finance/desdk";
import { parseEther } from "ethers/lib/utils";

declare module "mocha" {
    interface Context {
        chainId: number;
        deBridgeGate: DeBridgeGate;
        callProxy: CallProxy;
        dlnSource: DlnSource;
        dlnDestination: DlnDestination;
        maker: SignerWithAddress;
        taker: SignerWithAddress;
        unlockBeneficiary: SignerWithAddress;
        receiver: SignerWithAddress;
        orders: Array<OrderData>;
        submissionId: ContractTransaction
    }
}

export const testClaimBatchUnlock = () => function (this: Suite) {
    // setup graph of contracts
    beforeEach('setting up a graph of contracts', async () => {
        const [_deployer, maker, taker, unlockBeneficiary, receiver] = await hre.ethers.getSigners();

        this.ctx.chainId = await hre.network.provider.send('eth_chainId');
        const { deBridgeGate, dlnSource, dlnDestination } = await deployLoopbackDln()
        this.ctx.deBridgeGate = deBridgeGate;
        this.ctx.callProxy = new CallProxy__factory().attach(await this.ctx.deBridgeGate.callProxy());
        this.ctx.dlnSource = dlnSource;
        this.ctx.dlnDestination = dlnDestination

        this.ctx.maker = maker;
        this.ctx.taker = taker;
        this.ctx.unlockBeneficiary = unlockBeneficiary;
        this.ctx.receiver = receiver;
    });

    // create orders
    beforeEach('creating 10 orders', async () => {
        this.ctx.orders = await Promise.all(
            Array.from({length: 10}).map((_value, index) => createOrder(this.ctx.dlnSource, {
                giveTokenAddress: ethers.constants.AddressZero,
                giveAmount: 1 + index, // use incremental giveAmount to ensure unlocked liquidity is transferred properly
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                takeChainId: this.ctx.chainId,
                receiverDst: this.ctx.receiver.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.receiver.address,
                allowedTakerDst: Buffer.alloc(0),
                externalCall: Buffer.alloc(0),
                allowedCancelBeneficiarySrc: Buffer.alloc(0)
            }))
        );
    });

    // fulfilling
    beforeEach('fulfilling orders', async () => {
        await Promise.all(this.ctx.orders.map(({order}) => fulfillOrder(
            this.ctx.dlnDestination,
            order,
            this.ctx.taker.address
        )));
    });

    describe('claim_batch_unlock (single token)', function () {

        beforeEach("claim_batch_unlock of 10 x orders sent", async () => {
            this.ctx.submissionTx = await this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchEvmUnlock(
                this.ctx.orders.map(({orderId}) => orderId),
                this.ctx.unlockBeneficiary.address,
                0,
                { gasLimit: 8_000_000, value: await this.ctx.deBridgeGate.globalFixedNativeFee() }
            );
        })

        it("claim_batch_unlock emits 10x events", async () => {
            const claimTx = claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            for (let orderData of this.ctx.orders) {
                await expect(claimTx)
                    .to.emit(this.ctx.dlnSource, 'ClaimedUnlock')
                    .withArgs(
                        orderData.orderId,
                        this.ctx.unlockBeneficiary.address,
                        orderData.order.giveAmount,
                        orderData.order.giveTokenAddress
                    );
            }
        });

        it("claim_batch_unlock transfers give amount", async () => {
            const sumOfUnlockedOrders = this.ctx.orders
                .map(({order}) => BigNumber.from(order.giveAmount))
                .reduce((prevValue, currValue) => prevValue.add(currValue), BigNumber.from(0));
            await expect(() => claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx))
                .to.changeEtherBalances(
                    [this.ctx.unlockBeneficiary, this.ctx.dlnSource],
                    [sumOfUnlockedOrders, sumOfUnlockedOrders.mul(-1)]
                )
        });
    });

    xdescribe('claim_batch_unlock (different tokens)', function () {
        xit('n/a', async () => {})
    })

    describe('claim_batch_unlock: batch of 10 orders containing one inexistent order', function (this: Suite) {
        const state: {
            fakeOrderData: Partial<OrderData>,
            orders: Array<OrderData>
        } = {
            fakeOrderData: {},
            orders: []
        };

        beforeEach("prepare fake (fulfilled but not created) order", async () => {
            state.orders = this.ctx.orders.slice(0, 9);

            state.fakeOrderData.order = {
                makerOrderNonce: 0,
                makerSrc: Buffer.alloc(20, 0),
                giveChainId: this.ctx.chainId,
                giveTokenAddress: ethers.constants.AddressZero,
                giveAmount: 100,
                takeChainId: this.ctx.chainId,
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                receiverDst: this.ctx.receiver.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.receiver.address,
                allowedTakerDst: Buffer.alloc(0),
                allowedCancelBeneficiarySrc: Buffer.alloc(0),
                externalCall: Buffer.alloc(0)
            };
            state.fakeOrderData.orderId = await this.ctx.dlnDestination.getOrderId(state.fakeOrderData.order);
            await fulfillOrder(this.ctx.dlnDestination, state.fakeOrderData.order, this.ctx.taker.address);
        })

        beforeEach("sending claimBatchUnlock", async () => {
            this.ctx.submissionTx = await this.ctx.dlnDestination.connect(this.ctx.taker)
                .sendBatchEvmUnlock(
                    [
                        ...state.orders.map(({orderId}) => orderId),
                        state.fakeOrderData.orderId!
                    ],
                    this.ctx.unlockBeneficiary.address,
                    0,
                    { gasLimit: 8_000_000, value: await this.ctx.deBridgeGate.globalFixedNativeFee() }
                );
        })

        it("claim emits 9 x events for every valid order", async () => {
            const claimTx = claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);

            for (let orderData of state.orders) {
                await expect(claimTx)
                    .to.emit(this.ctx.dlnSource, 'ClaimedUnlock')
                    .withArgs(
                        orderData.orderId,
                        this.ctx.unlockBeneficiary.address,
                        orderData.order.giveAmount,
                        orderData.order.giveTokenAddress
                    );
            }
        });

        it("claim emits exactly 9x ClaimedUnlock events", async () => {
            const claimTx = await claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            const receipt = await claimTx.wait();

            const events = await findEvents<ClaimedUnlockEvent>(this.ctx.dlnSource, 'ClaimedUnlock', receipt);
            expect(events.length)
                .to.eq(state.orders.length)
        });

        it("claim transfers 9 wei (from every given valid order)", async () => {
            const sumOfUnlockedOrders = state.orders
                .map(({order}) => BigNumber.from(order.giveAmount))
                .reduce((prevValue, currValue) => prevValue.add(currValue), BigNumber.from(0));
            await expect(() => claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx))
                .to.changeEtherBalances(
                    [this.ctx.unlockBeneficiary, this.ctx.dlnSource],
                    [sumOfUnlockedOrders, sumOfUnlockedOrders.mul(-1)]
                )
        });

        it('claim unlock of an order sets status of an order as unlocked', async () => {
            await claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            for (let orderData of state.orders) {
                const giveOrder = await this.ctx.dlnSource.giveOrders(orderData.orderId);
                expect(giveOrder.status)
                    .to.eq(/*OrderGiveStatus.ClaimedUnlock*/2)
            }
        })

        it('claim unlock of an inexistent order does not change its the status', async () => {
            await claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            const giveOrder = await this.ctx.dlnSource.giveOrders(state.fakeOrderData.orderId!);
            expect(giveOrder.status)
                .to.eq(/*OrderGiveStatus.NotSet*/0)
        })

        it('claim unlock of an inexistent order emits event', async () => {
            const tx = claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            await expect(tx)
                .to.emit(this.ctx.dlnSource, 'UnexpectedOrderStatusForClaim')
                .withArgs(state.fakeOrderData.orderId, /*OrderGiveStatus.NotSet*/0, this.ctx.unlockBeneficiary.address)
        })

        it('claim unlock of an inexistent order records this order into the state', async () => {
            await claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            const recordedBeneficiary = await this.ctx.dlnSource.unexpectedOrderStatusForClaim(
                state.fakeOrderData.orderId!
            )
            expect(recordedBeneficiary)
                .to.eq(this.ctx.unlockBeneficiary.address)
        })
    });

    describe("claim_unlock fake order (compromised network)", function (this: Suite) {
        const compromisedChainId = 2;
        let tx: Promise<ContractTransaction>;
        let order: OrderData;

        beforeEach("prepare network", async () => {
            // enable additional DlnDestination at chainId=2 that is going to be compromised
            await this.ctx.deBridgeGate.setChainSupport(compromisedChainId, /*isSupported*/true, /*isChainIdFrom*/true);
            await this.ctx.deBridgeGate.setChainSupport(compromisedChainId, /*isSupported*/true, /*isChainIdFrom*/false);

            // non-obvious hack: we need to send a dummy message to the compromised chain to get deBridgeId registered automatically
            await this.ctx.deBridgeGate["sendMessage(uint256,bytes,bytes)"](compromisedChainId, Buffer.alloc(20, 100), Buffer.alloc(4, 100), { gasLimit: 8_000_000, value: parseEther("1") });

            // don't forget to let DLN know about DLN Destination on the compromised chain
            await this.ctx.dlnSource.setDlnDestinationAddress(compromisedChainId, this.ctx.dlnDestination.address, /*evm*/1);
        });

        beforeEach("claim_unlock", async () => {
            [order] = this.ctx.orders;

            const encodedCall = await this.ctx.dlnSource.populateTransaction
                .claimBatchUnlock([order.orderId], this.ctx.receiver.address);

            tx = this.ctx.deBridgeGate.claim(
                await this.ctx.deBridgeGate.getDebridgeId(this.ctx.chainId, await this.ctx.deBridgeGate.weth()),
                0,
                compromisedChainId,
                this.ctx.dlnSource.address,
                0,
                "0x12345678",
                new evm.ClaimAutoParams({
                    executionFee: '0',
                    flags: new evm.Flags(evm.Flag.PROXY_WITH_SENDER, evm.Flag.REVERT_IF_EXTERNAL_FAIL, evm.Flag.UNWRAP_ETH),
                    fallbackAddress: this.ctx.maker.address,
                    data: encodedCall.data!,
                    nativeSender: this.ctx.dlnDestination.address
                }).encode(),
                { gasLimit: 8_000_000, }
            );
        })

        it("must break circuit when chainIdFrom mismatches takeChainId during claim_unlock", async () => {
            // CriticalMismatchChainId(_orderId, _beneficiary, orderState.takeChainId, _submissionChainIdFrom);
            await expect(tx)
                .to.emit(this.ctx.dlnSource, 'CriticalMismatchChainId')
                .withArgs(order.orderId, this.ctx.receiver.address, order.order.takeChainId, compromisedChainId)
        });

        it('order status should remain untouched (Created)', async () => {
            await tx;

            const giveOrder = await this.ctx.dlnSource.giveOrders(order.orderId!);
            expect(giveOrder.status)
                .to.eq(/*OrderGiveStatus.Created*/1)
        })
    });

    describe('claim_unlock fake order (simplified: compromised network via fake CallProxy)', function (this:Suite) {
        const compromisedChainId = 2;
        let fakeCallProxy: MockCallProxy;
        let tx: Promise<ContractTransaction>;
        let order: OrderData;

        beforeEach("prepare fake CallProxy", async () => {
            // deploy fake callProxy which acts as a compromised bridge (simplified compromised network setup)
            const [_deployer] = await hre.ethers.getSigners();
            fakeCallProxy = await new MockCallProxy__factory(_deployer).deploy();
            await this.ctx.deBridgeGate.setCallProxy(fakeCallProxy.address);

            // enable additional DlnDestination at chainId=2 that is going to be compromised
            await this.ctx.deBridgeGate.setChainSupport(compromisedChainId, /*isSupported*/true, /*isChainIdFrom*/true);
            await this.ctx.deBridgeGate.setChainSupport(compromisedChainId, /*isSupported*/true, /*isChainIdFrom*/false);
            await this.ctx.dlnSource.setDlnDestinationAddress(compromisedChainId, this.ctx.dlnDestination.address, /*evm*/1);
        })

        beforeEach("claim_unlock", async () => {
            [order] = this.ctx.orders;

            const encodedCall = await this.ctx.dlnSource.populateTransaction
                .claimBatchUnlock([order.orderId], this.ctx.receiver.address);

            tx = fakeCallProxy!.bypassCall(
                this.ctx.dlnDestination.address,
                compromisedChainId,
                this.ctx.dlnSource.address,
                encodedCall.data!,
                { gasLimit: 8_000_000 }
            )
        });

        it('must break circuit when chainIdFrom mismatches takeChainId during claim_unlock', async () => {
            // CriticalMismatchChainId(_orderId, _beneficiary, orderState.takeChainId, _submissionChainIdFrom);
            await expect(tx)
                .to.emit(this.ctx.dlnSource, 'CriticalMismatchChainId')
                .withArgs(order.orderId, this.ctx.receiver.address, order.order.takeChainId, compromisedChainId)
        })

        it('order status should remain untouched (Created)', async () => {
            await tx;

            const giveOrder = await this.ctx.dlnSource.giveOrders(order.orderId!);
            expect(giveOrder.status)
                .to.eq(/*OrderGiveStatus.Created*/1)
        })
    })
}