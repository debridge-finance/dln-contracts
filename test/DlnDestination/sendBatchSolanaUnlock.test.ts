import hre, { ethers } from "hardhat";
import { DeBridgeGate } from "@debridge-finance/hardhat-debridge/dist/typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DlnDestination, MockDlnDestination__factory } from "../../typechain-types";
import { Suite } from "mocha";
import { deployDlnWithSolana, fulfillOrder } from "../utils/dln";
import { DlnOrderLib } from "../../typechain-types/contracts/DLN/DlnSource";
import { expect } from "chai";
import { Claim, DummySignatureStorage, SendAutoParams, Submission } from "@debridge-finance/desdk/lib/evm";
import { ContractTransaction } from "ethers";

type Order = DlnOrderLib.OrderStruct;

declare module "mocha" {
    interface Context {
        solanaChainId: number;
        takeChainId: number;
        gate: DeBridgeGate;
        dlnDestination: DlnDestination;
        taker: SignerWithAddress;
        ordersFromSolana: Array<Order>;
        nonces: number;

        tx: Promise<ContractTransaction>;
        submission: Submission;
    }
}

export const testSendBatchSolanaUnlock = () => function (this: Suite) {
    // setup graph of contracts
    before('setting up a graph of contracts', async () => {
        const [_deployer, taker] = await hre.ethers.getSigners();

        this.ctx.solanaChainId = 7565164;
        this.ctx.takeChainId = await hre.network.provider.send('eth_chainId');
        const { deBridgeGate, dlnDestination } = await deployDlnWithSolana(this.ctx.solanaChainId);
        this.ctx.gate = deBridgeGate;
        this.ctx.dlnDestination = dlnDestination

        this.ctx.taker = taker;
        this.ctx.nonces = 0;
    });

    // create orders
    // solana<>evm (multiple)
    before('creating orders', async () => {
        this.ctx.ordersFromSolana =
            Array.from({length: 11}).map((_v, key) => ({
                makerOrderNonce: ++this.ctx.nonces,
                makerSrc: Buffer.alloc(20, 0),
                giveChainId: this.ctx.solanaChainId,
                giveTokenAddress: Buffer.alloc(32, 0),
                giveAmount: key + 1,
                takeChainId: this.ctx.takeChainId,
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: key + 1,
                receiverDst: this.ctx.taker.address,
                givePatchAuthoritySrc: Buffer.alloc(32, 1),
                orderAuthorityAddressDst: this.ctx.taker.address,
                allowedTakerDst: Buffer.alloc(0),
                allowedCancelBeneficiarySrc: Buffer.alloc(0),
                externalCall: Buffer.alloc(0)
            }));
    });

    before('fulfilling orders', async () => {
        await Promise.all(this.ctx.ordersFromSolana.map(order => fulfillOrder(this.ctx.dlnDestination, order, this.ctx.taker.address)))
    });

    describe("sends 10 x claim_unlock to Solana", function () {
        const unlockBeneficiary = Buffer.alloc(32, 111);
        const batchSize = 10;
        const orders: Order[] = [];

        before(async () => {
            this.ctx.ordersFromSolana
                .slice(0, batchSize)
                .forEach(order => orders.push(order))

            this.ctx.tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
                orders,
                unlockBeneficiary,
                0, // execution fee
                0, // init_wallet_if_needed reward
                0, // claim_unlock reward
                { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
            );
        });

        it("must emit submission", async () => {
            // ensure deBridgeGate accepted submission (we also need submissionId to ensure DlnDestination emitted corresponding events)
            const [submission] = await Submission.findAll((await this.ctx.tx).hash, {
                provider: hre,
                deBridgeGateAddress: this.ctx.gate.address,
                signatureStorage: new DummySignatureStorage
            })
            expect(submission).to.be.instanceOf(Submission);
            expect(submission.autoParams).to.be.instanceOf(SendAutoParams);

            this.ctx.submission = submission;
        });

        it("must contain properly serialized external instructions", async () => {
            const [deployer] = await hre.ethers.getSigners();
            const mock = await new MockDlnDestination__factory(deployer).deploy();
            const solanaProgramId = await this.ctx.dlnDestination.dlnSourceAddresses(this.ctx.solanaChainId);
            const instructions = [
                await mock.encodeSolanaInitWalletIfNeeded(unlockBeneficiary, orders[0].giveTokenAddress, 0)
            ];
            for (let order of orders) {
                instructions.push(
                    await mock.encodeSolanaClaimUnlockInstruction(
                        this.ctx.takeChainId,
                        solanaProgramId, // srcProgramId
                        unlockBeneficiary,
                        order.giveTokenAddress,
                        await this.ctx.dlnDestination.getOrderId(order),
                        0
                    )
                );
            }

            const resultingBytes = '0x' + (
                instructions
                    .map(instruction => instruction.slice(2))
                    .join("")
            );

            expect(this.ctx.submission.autoParams?.data)
                .to.eq(resultingBytes)
        })

        it("must emit proper SentOrderUnlock events", async () => {
            for (let i = 0; i < batchSize; i++) {
                const order = orders[i];
                // ensure DlnDestination emitted corresponding events
                await expect(this.ctx.tx, `order ${i}`)
                    .to.emit(this.ctx.dlnDestination, 'SentOrderUnlock')
                    .withArgs(
                        await this.ctx.dlnDestination.getOrderId(order),
                        unlockBeneficiary,
                        this.ctx.submission.submissionId
                    )
            }
        });
    });

    xit("sends 10 x claim_unlock to Solana with execution fee (NOT_READY)", async () => {
        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            this.ctx.ordersFromSolana.slice(0, 9),
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );
    });

    it("fails sending 11 x claim_unlock to Solana", async () => {
        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            this.ctx.ordersFromSolana,
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'UnexpectedBatchSize')
    });

    it("fails sending empty batch to Solana", async () => {
        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'UnexpectedBatchSize')
    });

    it("fails sending batch with mixed giveChainId to Solana", async () => {
        const orderFromUnexpectedChain = {
            makerOrderNonce: ++this.ctx.nonces,
            makerSrc: Buffer.alloc(20, 0),
            giveChainId: this.ctx.takeChainId, // <- unexpected give chain
            giveTokenAddress: ethers.constants.AddressZero,
            giveAmount: 1,
            takeChainId: this.ctx.takeChainId,
            takeTokenAddress: ethers.constants.AddressZero,
            takeAmount: 1,
            receiverDst: this.ctx.taker.address,
            givePatchAuthoritySrc: Buffer.alloc(32, 1),
            orderAuthorityAddressDst: this.ctx.taker.address,
            allowedTakerDst: Buffer.alloc(0),
            allowedCancelBeneficiarySrc: Buffer.alloc(0),
            externalCall: Buffer.alloc(0)
        };
        await fulfillOrder(this.ctx.dlnDestination, orderFromUnexpectedChain, this.ctx.taker.address);

        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [
                ...this.ctx.ordersFromSolana.slice(0, 8), // take 9 orders
                orderFromUnexpectedChain
            ],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'WrongChain')
    });

    it("fails sending batch with mixed giveTokenAddress to Solana", async () => {
        const orderFromSolanaWithUnexpectedGiveToken = {
            makerOrderNonce: ++this.ctx.nonces,
            makerSrc: Buffer.alloc(20, 0),
            giveChainId: this.ctx.solanaChainId,
            giveTokenAddress: Buffer.alloc(32, 1), // <- unexpected (non-zero) give token
            giveAmount: 1,
            takeChainId: this.ctx.takeChainId,
            takeTokenAddress: ethers.constants.AddressZero,
            takeAmount: 1,
            receiverDst: this.ctx.taker.address,
            givePatchAuthoritySrc: Buffer.alloc(32, 1),
            orderAuthorityAddressDst: this.ctx.taker.address,
            allowedTakerDst: Buffer.alloc(0),
            allowedCancelBeneficiarySrc: Buffer.alloc(0),
            externalCall: Buffer.alloc(0)
        };
        await fulfillOrder(this.ctx.dlnDestination, orderFromSolanaWithUnexpectedGiveToken, this.ctx.taker.address);

        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [
                ...this.ctx.ordersFromSolana.slice(0, 8), // take 9 orders
                orderFromSolanaWithUnexpectedGiveToken
            ],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'WrongToken')
    });

    it("fails sending batch containing non-fulfilled order to Solana", async () => {
        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [
                ...this.ctx.ordersFromSolana.slice(0, 8), // take 9 orders
                { // <!-- non-fulfilled order
                    makerOrderNonce: ++this.ctx.nonces,
                    makerSrc: Buffer.alloc(20, 0),
                    giveChainId: this.ctx.solanaChainId,
                    giveTokenAddress: Buffer.alloc(32, 0),
                    giveAmount: 1,
                    takeChainId: this.ctx.takeChainId,
                    takeTokenAddress: ethers.constants.AddressZero,
                    takeAmount: 1,
                    receiverDst: this.ctx.taker.address,
                    givePatchAuthoritySrc: Buffer.alloc(32, 1),
                    orderAuthorityAddressDst: this.ctx.taker.address,
                    allowedTakerDst: Buffer.alloc(0),
                    allowedCancelBeneficiarySrc: Buffer.alloc(0),
                    externalCall: Buffer.alloc(0)
                }
            ],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'IncorrectOrderStatus')
    });

    it("fails sending batch containing unlocked (sent_unlock) order to Solana", async () => {
        const unlockedOrder = {
            makerOrderNonce: ++this.ctx.nonces,
            makerSrc: Buffer.alloc(20, 0),
            giveChainId: this.ctx.solanaChainId,
            giveTokenAddress: Buffer.alloc(32, 0),
            giveAmount: 1,
            takeChainId: this.ctx.takeChainId,
            takeTokenAddress: ethers.constants.AddressZero,
            takeAmount: 1,
            receiverDst: this.ctx.taker.address,
            givePatchAuthoritySrc: Buffer.alloc(32, 1),
            orderAuthorityAddressDst: this.ctx.taker.address,
            allowedTakerDst: Buffer.alloc(0),
            allowedCancelBeneficiarySrc: Buffer.alloc(0),
            externalCall: Buffer.alloc(0)
        };
        await fulfillOrder(this.ctx.dlnDestination, unlockedOrder, this.ctx.taker.address);
        await this.ctx.dlnDestination.connect(this.ctx.taker).sendSolanaUnlock(
            unlockedOrder,
            Buffer.alloc(32, 111), // unlockBeneficiary
            0,
            0,
            0,
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [
                ...this.ctx.ordersFromSolana.slice(0, 8), // take 9 orders
                unlockedOrder
            ],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'IncorrectOrderStatus')
    });

    it("fails sending batch containing cancelled (sent_cancel) order to Solana", async () => {
        const cancelledOrder = {
            makerOrderNonce: ++this.ctx.nonces,
            makerSrc: Buffer.alloc(20, 0),
            giveChainId: this.ctx.solanaChainId,
            giveTokenAddress: Buffer.alloc(32, 0),
            giveAmount: 1,
            takeChainId: this.ctx.takeChainId,
            takeTokenAddress: ethers.constants.AddressZero,
            takeAmount: 1,
            receiverDst: this.ctx.taker.address,
            givePatchAuthoritySrc: Buffer.alloc(32, 1),
            orderAuthorityAddressDst: this.ctx.taker.address,
            allowedTakerDst: Buffer.alloc(0),
            allowedCancelBeneficiarySrc: Buffer.alloc(0),
            externalCall: Buffer.alloc(0)
        };
        await this.ctx.dlnDestination.connect(this.ctx.taker).sendSolanaOrderCancel(
            cancelledOrder,
            Buffer.alloc(32, 111), // cancelBeneficiary,
            0,
            0,
            0,
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [
                ...this.ctx.ordersFromSolana.slice(0, 8), // take 9 orders
                cancelledOrder
            ],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'IncorrectOrderStatus')
    });

    it("fails sending batch containing mixed unlock authorities to Solana", async () => {
        const orderWithZeroUnlockAuthority = {
            makerOrderNonce: ++this.ctx.nonces,
            makerSrc: Buffer.alloc(20, 0),
            giveChainId: this.ctx.solanaChainId,
            giveTokenAddress: Buffer.alloc(32, 0),
            giveAmount: 1,
            takeChainId: this.ctx.takeChainId,
            takeTokenAddress: ethers.constants.AddressZero,
            takeAmount: 1,
            receiverDst: this.ctx.taker.address,
            givePatchAuthoritySrc: Buffer.alloc(32, 1),
            orderAuthorityAddressDst: this.ctx.taker.address,
            allowedTakerDst: Buffer.alloc(0),
            allowedCancelBeneficiarySrc: Buffer.alloc(0),
            externalCall: Buffer.alloc(0)
        };
        // <!-- order unlock authority is zero
        await fulfillOrder(this.ctx.dlnDestination, orderWithZeroUnlockAuthority, ethers.constants.AddressZero);

        const tx = this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchSolanaUnlock(
            [
                ...this.ctx.ordersFromSolana.slice(0, 8), // take 9 orders
                orderWithZeroUnlockAuthority
            ],
            Buffer.alloc(32, 111), // unlockBeneficiary
            0, // execution fee
            0, // init_wallet_if_needed reward
            0, // claim_unlock reward
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );

        await expect(tx)
            .to.revertedWithCustomError(this.ctx.dlnDestination, 'Unauthorized')
    });
}