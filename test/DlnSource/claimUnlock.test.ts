import hre, { ethers } from "hardhat";
import { DeBridgeGate } from "@debridge-finance/hardhat-debridge/dist/typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { CallProxy, DlnDestination, MockCallProxy, MockCallProxy__factory } from "../../typechain-types";
import { Suite } from "mocha";
import { createOrder, deployLoopbackDln, fulfillOrder, Order, OrderData, OrderId } from "../utils/dln";
import { DlnSource } from "../../typechain-types/contracts/DLN/DlnSource";
import { expect } from "chai";
import { claimSubmission } from "../utils/deBridge";
import { CallProxy__factory } from "@debridge-finance/desdk/lib/evm/typechain";
import { ContractTransaction } from "ethers";
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
        submissionId: ContractTransaction;
    }
}

export const testClaimUnlock = () => function (this: Suite) {
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
    beforeEach('creating 11 orders', async () => {
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

    describe('claim_unlock of an order', function () {
        const state: {
            submissionTx?: ContractTransaction,
            orderId?: OrderId,
            order?: Order
        } = {};

        beforeEach("claims unlock of an order", async () => {
            const { orderId, order } = this.ctx.orders[0];
            state.orderId = orderId;
            state.order = order;
            state.submissionTx = await this.ctx.dlnDestination.connect(this.ctx.taker).sendEvmUnlock(
                orderId,
                this.ctx.unlockBeneficiary.address,
                0,
                { gasLimit: 8_000_000, value: await this.ctx.deBridgeGate.globalFixedNativeFee() }
            );
        })

        it("claim unlock of an order emits event", async () => {
            const claimTx = claimSubmission(this.ctx.deBridgeGate, state.submissionTx!);
            await expect(claimTx)
                .to.emit(this.ctx.dlnSource, 'ClaimedUnlock')
                .withArgs(
                    state.orderId!,
                    this.ctx.unlockBeneficiary.address,
                    state.order!.giveAmount,
                    state.order!.giveTokenAddress
                );
        });

        it("claim unlock of an order transfers ether", async () => {
            await expect(() => claimSubmission(this.ctx.deBridgeGate, state.submissionTx!))
                .to.changeEtherBalances(
                    [this.ctx.unlockBeneficiary, this.ctx.dlnSource],
                    [state.order!.giveAmount, -(state.order!.giveAmount)]
                )
        });

        it('claim unlock of an order sets status of an order as unlocked', async () => {
            await claimSubmission(this.ctx.deBridgeGate, state.submissionTx!);
            const giveOrder = await this.ctx.dlnSource.giveOrders(state.orderId!);
            expect(giveOrder.status)
                .to.eq(/*OrderGiveStatus.ClaimedUnlock*/2)
        })
    })

    describe("claim_unlock inexistent order", function (this: Suite) {
        const state: {
            fakeOrderData: Partial<OrderData>,
        } = {
            fakeOrderData: {},
        };

        beforeEach("prepare fake (fulfilled but not created) order", async () => {
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

        beforeEach("send claim_unlock", async () => {
            this.ctx.submissionTx = await this.ctx.dlnDestination.connect(this.ctx.taker)
                .sendEvmUnlock(
                    state.fakeOrderData.orderId!,
                    this.ctx.receiver.address,
                    0,
                    { gasLimit: 8_000_000, value: await this.ctx.deBridgeGate.globalFixedNativeFee() }
                );
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
                .withArgs(state.fakeOrderData.orderId, /*OrderGiveStatus.NotSet*/0, this.ctx.receiver.address)
        })

        it('claim unlock of an inexistent order records this order into the state', async () => {
            await claimSubmission(this.ctx.deBridgeGate, this.ctx.submissionTx);
            const recordedBeneficiary = await this.ctx.dlnSource.unexpectedOrderStatusForClaim(
                state.fakeOrderData.orderId!
            )
            expect(recordedBeneficiary)
                .to.eq(this.ctx.receiver.address)
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
                .claimUnlock(order.orderId, this.ctx.receiver.address);

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
                .claimUnlock(order.orderId, this.ctx.receiver.address);

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