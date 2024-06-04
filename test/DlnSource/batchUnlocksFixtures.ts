import hre, { ethers } from "hardhat";
import { DeBridgeGate } from "@debridge-finance/hardhat-debridge/dist/typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DlnDestination, DlnSource, DummyToken, MockReceiver, MockReceiver__factory } from "../../typechain-types";
import { Suite } from "mocha";
import { createOrder, deployLoopbackDln, fulfillOrder, OrderData } from "../utils/dln";
import { deployERC20Token } from "../utils/common";
import { BigNumber } from "ethers";
import { ContractTransaction } from "@ethersproject/contracts"
import { expect } from "chai";
import { claimSubmission } from "../utils/deBridge";

declare module "mocha" {
    interface Context {
        tokenA: DummyToken;
        tokenB: DummyToken;
        gate: DeBridgeGate;
        dlnSource: DlnSource;
        dlnDestination: DlnDestination;
        taker: SignerWithAddress;
        maker: SignerWithAddress;
        orders: Array<OrderData>;
        receiver: MockReceiver;
        submissionTx: ContractTransaction | Promise<ContractTransaction>
    }
}

export const testBatchUnlock = (shift: number) => function (this: Suite) {
    // setup graph of contracts
    beforeEach('setting up a graph of contracts', async () => {
        const [_deployer, taker, maker] = await hre.ethers.getSigners();
        this.ctx.tokenA = await deployERC20Token("tokenA", 6);
        this.ctx.tokenB = await deployERC20Token("tokenB", 6);

        const { deBridgeGate, dlnSource, dlnDestination } = await deployLoopbackDln();
        this.ctx.gate = deBridgeGate;
        this.ctx.dlnSource = dlnSource;
        this.ctx.dlnDestination = dlnDestination

        this.ctx.taker = taker;
        this.ctx.maker = maker;
        this.ctx.receiver = await new MockReceiver__factory(_deployer).deploy();
    });

    // mint tokens
    beforeEach('minting erc-20 tokens', async () => {
        this.ctx.tokenA.mint(this.ctx.maker.address, 1000 * 1e6)
        this.ctx.tokenB.mint(this.ctx.maker.address, 1000 * 1e6)
    });

    // create orders
    beforeEach('creating orders', async () => {
        // we create three orders for three different tokens:
        // 1) 3x orders with give=native, amounts: 10, 11, 12
        // 2) 3x orders with give=tokenA, amounts: 20, 21, 22
        // 3) 3x orders with give=tokenB, amounts: 30, 31, 32
        // Then, batch unlock them and check that claimUnlock() performs exactly 7 transfers,
        // were the first transfer combines native|tokenA amounts

        const chainId = await hre.network.provider.send('eth_chainId');

        const orders1 = await Promise.all(
            Array.from({ length: 3 }).map((_v, key) => createOrder(this.ctx.dlnSource, {
                giveTokenAddress: ethers.constants.AddressZero,
                giveAmount: BigNumber.from(10 + key).mul(BigNumber.from(10).pow(18)),
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                takeChainId: chainId,
                receiverDst: this.ctx.maker.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.maker.address,
                allowedTakerDst: Buffer.alloc(0),
                externalCall: Buffer.alloc(0),
                allowedCancelBeneficiarySrc: Buffer.alloc(0),
            }))
        );

        const orders2 = await Promise.all(
            Array.from({ length: 3 }).map((_v, key) => createOrder(this.ctx.dlnSource.connect(this.ctx.maker), {
                giveTokenAddress: this.ctx.tokenA.address,
                giveAmount: (20 + key) * 1e6,
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                takeChainId: chainId,
                receiverDst: this.ctx.maker.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.maker.address,
                allowedTakerDst: Buffer.alloc(0),
                externalCall: Buffer.alloc(0),
                allowedCancelBeneficiarySrc: Buffer.alloc(0),
            }))
        );

        const orders3 = await Promise.all(
            Array.from({ length: 3 }).map((_v, key) => createOrder(this.ctx.dlnSource.connect(this.ctx.maker), {
                giveTokenAddress: this.ctx.tokenB.address,
                giveAmount: (30 + key) * 1e6,
                takeTokenAddress: ethers.constants.AddressZero,
                takeAmount: 0,
                takeChainId: chainId,
                receiverDst: this.ctx.maker.address,
                givePatchAuthoritySrc: this.ctx.maker.address,
                orderAuthorityAddressDst: this.ctx.maker.address,
                allowedTakerDst: Buffer.alloc(0),
                externalCall: Buffer.alloc(0),
                allowedCancelBeneficiarySrc: Buffer.alloc(0),
            }))
        );

        this.ctx.orders = [...orders1, ...orders2, ...orders3];
    });

    beforeEach('fulfilling orders', async () => {
        await Promise.all(this.ctx.orders.map(({ order }) => fulfillOrder(
            this.ctx.dlnDestination,
            order,
            this.ctx.taker.address
        )));
    })

    beforeEach("Perform unlock", async () => {
        const orders = this.ctx.orders.slice(shift).concat(this.ctx.orders.slice(0, shift));
        
        // send batch unlock thru the gate
        this.ctx.submissionTx = await this.ctx.dlnDestination.connect(this.ctx.taker).sendBatchEvmUnlock(
            orders.map(({ orderId }) => orderId),
            this.ctx.receiver.address,
            0,
            { gasLimit: 8_000_000, value: await this.ctx.gate.globalFixedNativeFee() }
        );
    });

    if (shift==0) {
        it("Shift 0. Should do a single transfer of ether | tokenA | tokenB", async () => {
            const claimTx = claimSubmission(this.ctx.gate, this.ctx.submissionTx);
            const amountForUnlockTokenA = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenA.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            const amountForUnlockTokenB = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenB.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            await expect(claimTx)
                .to.emit(this.ctx.receiver, 'ReceivedEther')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.orders
                        .filter(order => order.order.giveTokenAddress.addressEq(ethers.constants.AddressZero))
                        .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0))
                )
                .to.emit(this.ctx.tokenA, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenA
                )
                .to.emit(this.ctx.tokenB, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenB
                )
        })
    }
    else if (shift==1) {
        it("Shift 1. Should do a single transfer tokenA | tokenB and two ethers transfer", async () => {
            const claimTx = claimSubmission(this.ctx.gate, this.ctx.submissionTx);
            const amountForUnlockTokenA = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenA.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            const amountForUnlockTokenB = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenB.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            await expect(claimTx)
                .to.emit(this.ctx.receiver, 'ReceivedEther')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.orders[1].order.giveAmount.add(this.ctx.orders[2].order.giveAmount)
                )
                .to.emit(this.ctx.receiver, 'ReceivedEther')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.orders[0].order.giveAmount
                )
                .to.emit(this.ctx.tokenA, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenA
                )
                .to.emit(this.ctx.tokenB, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenB
                )
        })
    }
    else if (shift==2) {
        it("Shift 2. Should do a single transfer tokenA | tokenB and two ethers transfer", async () => {
            const claimTx = claimSubmission(this.ctx.gate, this.ctx.submissionTx);
            const amountForUnlockTokenA = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenA.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            const amountForUnlockTokenB = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenB.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            await expect(claimTx)
                .to.emit(this.ctx.receiver, 'ReceivedEther')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.orders[2].order.giveAmount
                )
                .to.emit(this.ctx.receiver, 'ReceivedEther')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.orders[0].order.giveAmount.add(this.ctx.orders[1].order.giveAmount)
                )
                .to.emit(this.ctx.tokenA, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenA
                )
                .to.emit(this.ctx.tokenB, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenB
                )
        })
    }
    else if (shift==4) {
        it("Shift 4. Should do a single transfer ethers| tokenB and two tokenA transfer", async () => {
            const claimTx = claimSubmission(this.ctx.gate, this.ctx.submissionTx);
            const amountForUnlockETH = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(ethers.constants.AddressZero))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            const amountForUnlockTokenB = this.ctx.orders
                .filter(order => order.order.giveTokenAddress.addressEq(this.ctx.tokenB.address))
                .reduce((prevValue, { order }) => order.giveAmount.add(prevValue), BigNumber.from(0));

            await expect(claimTx)
                .to.emit(this.ctx.receiver, 'ReceivedEther')
                .withArgs(
                    this.ctx.dlnSource.address,
                    amountForUnlockETH
                )
                .to.emit(this.ctx.tokenA, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    this.ctx.orders[4].order.giveAmount.add(this.ctx.orders[5].order.giveAmount)
                )
                .to.emit(this.ctx.tokenB, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    amountForUnlockTokenB
                )
                .to.emit(this.ctx.tokenA, 'Transfer')
                .withArgs(
                    this.ctx.dlnSource.address,
                    this.ctx.receiver.address,
                    this.ctx.orders[3].order.giveAmount
                )
        })
    }
}