import { artifacts, ethers, upgrades, waffle } from "hardhat";
import { deployMockContract, MockContract, Stub } from '@ethereum-waffle/mock-contract';
import { expect } from "chai";
import { DlnExternalCallAdapter, ExternalCallExecutor, MockToken, MockCallReceiver } from "../typechain-types";
const debridgeInitParams = require("../assets/debridgeInitParams");
import Web3 from "web3";
import expectEvent from "./utils/expectEventFork";
import { deployMockContract } from "@ethereum-waffle/mock-contract";
import { packExternalCall, getExternalCallId } from "./utils.spec";
import { toBn } from "./utils/toBn";
import { attachAs, BSC_CHAIN_ID, createCoreContract, deployAs, ETH_CHAIN_ID, POLYGON_CHAIN_ID } from './utils/configureCore';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import * as crypto from 'crypto';
// const crypto = require('crypto');

const ZERO_ADDRESS = ethers.constants.AddressZero;
const usdcDecimals = 6;
const busdDecimals = 18;
const ETHDecimals = 18;

describe('DlnExternalCallAdapter', () => {

  let [deployerAccount, aliceAccount, bobAccount, konradAccount, alexAccount]: SignerWithAddress[] = [];
  let [deployer, alice, bob, konrad, alex]: string[] = [];
  let externalCallAdapter: DlnExternalCallAdapter;
  let externalCallExecutor: ExternalCallExecutor;
  let mockCallReceiver: MockCallReceiver;
  let usdcToken: MockToken;
  let busdToken: MockToken;
  // We will use EOA as DlnDestination contract address;
  let fakeDlnDestination: string;

  before(async () => {
    [deployerAccount, aliceAccount, bobAccount, konradAccount, alexAccount] = await ethers.getSigners();

    deployer = deployerAccount.address;
    alice = aliceAccount.address;
    bob = bobAccount.address;
    konrad = konradAccount.address;
    alex = alexAccount.address;

    fakeDlnDestination = alice;
    externalCallExecutor = await deployAs(deployerAccount, 'ExternalCallExecutor') as ExternalCallExecutor;

    const dlnExternalCallAdapterFactory = await ethers.getContractFactory("DlnExternalCallAdapter", deployer);


    //initialize(address _dlnDestination, address _executor)
    externalCallAdapter = await upgrades.deployProxy(
      dlnExternalCallAdapterFactory,
      [
        fakeDlnDestination,
        externalCallExecutor.address,
      ],
      {
        initializer: "initialize",
        kind: "transparent",
      }
    ) as DlnExternalCallAdapter;

    const ADAPTER_ROLE = await externalCallExecutor.ADAPTER_ROLE();
    await externalCallExecutor.grantRole(ADAPTER_ROLE, externalCallAdapter.address);

    mockCallReceiver = await deployAs(deployerAccount, 'MockCallReceiver') as MockCallReceiver;

    // configure tokens
    usdcToken = await deployAs(deployerAccount, 'MockToken', "USD Coin", "USDC", usdcDecimals) as MockToken;
    busdToken = await deployAs(deployerAccount, 'MockToken', "Binance-Peg BUSD Token", "Cake", busdDecimals) as MockToken;
    const mintUsdcAmount = 1000 * (10 ** usdcDecimals);
    await usdcToken.mint(alice, mintUsdcAmount);
    // await usdcToken.connect(aliceAccount).approve(dlnSourceEth.address, mintUsdcAmount);

    const mintBusdAmount = Web3.utils.toWei("1000");
    await busdToken.mint(bob, mintBusdAmount);
    // await busdToken.connect(bobAccount).approve(dlnDestinationBSC.address, mintBusdAmount);
  });


  context("Configure contracts", () => {
    it('Check init contract params', async () => {
      expect((await externalCallAdapter.defaultExecutor()).toString()).to.equal(externalCallExecutor.address);
      expect((await externalCallAdapter.dlnDestination()).toString()).to.equal(fakeDlnDestination);
    });
  });

  context("Check initializable", () => {
    it("DlnExternalCallAdapter implementation should revert if call initialize", async function () {
      const factory = await ethers.getContractFactory("DlnExternalCallAdapter", alice);
      const contract = await factory.deploy();
      await expect(contract.initialize(fakeDlnDestination, externalCallExecutor.address)).to.be.revertedWith(`Initializable: contract is already initialized`);
    });
    it("DlnExternalCallAdapter proxy should revert if call initialize", async function () {
      await expect(externalCallAdapter.initialize(fakeDlnDestination, externalCallExecutor.address)).to.be.revertedWith(`Initializable: contract is already initialized`);
    });
  });

  context("Test check error", () => {
    it('Only dlnDestination contract can call receiveCall', async () => {
      await expect(externalCallAdapter.connect(bobAccount).receiveCall(
        "0x" + crypto.randomBytes(32).toString('hex'), //_orderId
        ZERO_ADDRESS, //_callAuthority
        ZERO_ADDRESS, //_tokenAddress
        100000, //_transferredAmount
        "0x11223344", //_externalCall
        bob, //_externalCallRewardBeneficiary
      )).to.be.revertedWithCustomError(externalCallAdapter, "DlnBadRole");
    });
  });

  context("Check receive external call", () => {
    context("Reward beneficiary is set", () => {
      it('Should success if external data is correct', async () => {
        const transferredAmount = 5 * (10 ** usdcDecimals);
        const executionFee = 1 * (10 ** usdcDecimals);
        const to = mockCallReceiver.address;
        const orderId = "0x" + crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        await usdcToken.mint(externalCallAdapter.address, transferredAmount);
        const fallbackAddress = konrad;
        const rewardBeneficiary = alex;
        const receiverUSDCBefore = toBn(await usdcToken.balanceOf(mockCallReceiver.address));
        const rewardBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(rewardBeneficiary));
        const callData = mockCallReceiver.interface.encodeFunctionData("collectTokens", [
          usdcToken.address,
          transferredAmount - executionFee
        ]);
        const safeTxGas = 1000_000;
        // packExternalCall(executionFee, fallbackAddress, safeTxGas, executor, allowDelayedExecution, requireSuccessfullExecution, callData)
        const externalCall = packExternalCall(executionFee, fallbackAddress, safeTxGas, ZERO_ADDRESS, true, true, to, callData);

        // console.log("executionFee", executionFee.toString(16));
        // console.log("safeTxGas", safeTxGas.toString(16));
        // console.log("fallbackAddress", fallbackAddress);
        // console.log("callData", callData);

        // console.log("externalCall", externalCall);

        const txSource = await externalCallAdapter.connect(aliceAccount).receiveCall(
          orderId,
          callAuthority,
          usdcToken.address, //_tokenAddress
          transferredAmount, //_transferredAmount
          externalCall,
          rewardBeneficiary //_externalCallRewardBeneficiary
        );
        //check events
        //event ExternalCallExecuted(bytes32 orderId, bool callSucceeded);
        await expectEvent.inTransaction(
          txSource.hash,
          artifacts.require('DlnExternalCallAdapter'),
          "ExternalCallExecuted",
          {
            orderId: orderId,
            callSucceeded: true,
          }
        );
        const receiverUSDCAfter = toBn(await usdcToken.balanceOf(mockCallReceiver.address));
        const rewardBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(rewardBeneficiary));

        // console.log("receiverUSDCBefore", receiverUSDCBefore);
        // console.log("rewardBeneficiaryUSDCBefore", rewardBeneficiaryUSDCBefore);
        // console.log("receiverUSDCAfter", receiverUSDCAfter);
        // console.log("rewardBeneficiaryUSDCAfter", rewardBeneficiaryUSDCAfter);
        expect(receiverUSDCAfter.sub(receiverUSDCBefore)).to.equal(transferredAmount - executionFee);

        expect(rewardBeneficiaryUSDCAfter.sub(rewardBeneficiaryUSDCBefore)).to.equal(executionFee);
      });
      it('Should success if external data is correct (executionFee = 0)', async () => {
        const transferredAmount = 5 * (10 ** usdcDecimals);
        const executionFee = 0;
        const to = mockCallReceiver.address;
        const orderId = "0x" + crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        await usdcToken.mint(externalCallAdapter.address, transferredAmount);
        const fallbackAddress = konrad;
        const rewardBeneficiary = alex;
        const receiverUSDCBefore = toBn(await usdcToken.balanceOf(mockCallReceiver.address));
        const rewardBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(rewardBeneficiary));
        const callData = mockCallReceiver.interface.encodeFunctionData("collectTokens", [
          usdcToken.address,
          transferredAmount - executionFee
        ]);
        const safeTxGas = 1000_000;
        // packExternalCall(executionFee, fallbackAddress, safeTxGas, executor, allowDelayedExecution, requireSuccessfullExecution, callData)
        const externalCall = packExternalCall(executionFee, fallbackAddress, safeTxGas, ZERO_ADDRESS, true, true, to, callData);

        // console.log("executionFee", executionFee.toString(16));
        // console.log("safeTxGas", safeTxGas.toString(16));
        // console.log("fallbackAddress", fallbackAddress);
        // console.log("callData", callData);

        // console.log("externalCall", externalCall);

        const txSource = await externalCallAdapter.connect(aliceAccount).receiveCall(
          orderId,
          callAuthority,
          usdcToken.address, //_tokenAddress
          transferredAmount, //_transferredAmount
          externalCall,
          rewardBeneficiary //_externalCallRewardBeneficiary
        );
        //check events
        //event ExternalCallExecuted(bytes32 orderId, bool callSucceeded);
        await expectEvent.inTransaction(
          txSource.hash,
          artifacts.require('DlnExternalCallAdapter'),
          "ExternalCallExecuted",
          {
            orderId: orderId,
            callSucceeded: true,
          }
        );
        const receiverUSDCAfter = toBn(await usdcToken.balanceOf(mockCallReceiver.address));
        const rewardBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(rewardBeneficiary));

        // console.log("receiverUSDCBefore", receiverUSDCBefore);
        // console.log("rewardBeneficiaryUSDCBefore", rewardBeneficiaryUSDCBefore);
        // console.log("receiverUSDCAfter", receiverUSDCAfter);
        // console.log("rewardBeneficiaryUSDCAfter", rewardBeneficiaryUSDCAfter);
        expect(receiverUSDCAfter.sub(receiverUSDCBefore)).to.equal(transferredAmount - executionFee);

        expect(rewardBeneficiaryUSDCAfter.sub(rewardBeneficiaryUSDCBefore)).to.equal(executionFee);
      });
      it('Should send token to fallback address if external call failed', async () => {
        const transferredAmount = 5 * (10 ** usdcDecimals);
        const executionFee = 1 * (10 ** usdcDecimals);
        const to = bob;
        const orderId = "0x" + crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        await usdcToken.mint(externalCallAdapter.address, transferredAmount);
        const fallbackAddress = konrad;
        const rewardBeneficiary = alex;
        const fallbackUSDCBefore = toBn(await usdcToken.balanceOf(fallbackAddress));
        const rewardBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(rewardBeneficiary));
        const callData = "0x11223344";
        const safeTxGas = 1000000;
        // packExternalCall(executionFee, fallbackAddress, safeTxGas, executor, allowDelayedExecution, requireSuccessfullExecution, callData)
        const externalCall = packExternalCall(executionFee.toString(), fallbackAddress, safeTxGas, ZERO_ADDRESS, true, false, to, callData);

        // console.log("externalCall", externalCall);
        const txSource = await externalCallAdapter.connect(aliceAccount).receiveCall(
          orderId,
          callAuthority,
          usdcToken.address, //_tokenAddress
          transferredAmount, //_transferredAmount
          externalCall,
          rewardBeneficiary //_externalCallRewardBeneficiary
        );
        //check events
        //event ExternalCallExecuted(bytes32 orderId, bool callSucceeded);
        await expectEvent.inTransaction(
          txSource.hash,
          artifacts.require('DlnExternalCallAdapter'),
          "ExternalCallExecuted",
          {
            orderId: orderId,
            callSucceeded: false,
          }
        );
        const fallbackUSDCAfter = toBn(await usdcToken.balanceOf(fallbackAddress));
        const rewardBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(rewardBeneficiary));

        // console.log("fallbackUSDCBefore", fallbackUSDCBefore);
        // console.log("rewardBeneficiaryUSDCBefore", rewardBeneficiaryUSDCBefore);
        // console.log("fallbackUSDCAfter", fallbackUSDCAfter);
        // console.log("rewardBeneficiaryUSDCAfter", rewardBeneficiaryUSDCAfter);
        expect(fallbackUSDCAfter.sub(fallbackUSDCBefore)).to.equal(transferredAmount - executionFee);

        expect(rewardBeneficiaryUSDCAfter.sub(rewardBeneficiaryUSDCBefore)).to.equal(executionFee);
      });
      it('Should register call if empty execution reward beneficiary', async () => {
        const transferredAmount = 5 * (10 ** usdcDecimals);
        const executionFee = 1 * (10 ** usdcDecimals);
        const to = mockCallReceiver.address;
        const orderId = "0xb32e4a0db32c990b4c006f367c71aa32e4dd81aac221fd25eb0b3782072ca81a";// "0x"+crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        await usdcToken.mint(externalCallAdapter.address, transferredAmount);
        const fallbackAddress = konrad;
        const rewardBeneficiary = ZERO_ADDRESS;
        const adapterUSDCBefore = toBn(await usdcToken.balanceOf(externalCallAdapter.address));
        const rewardBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(rewardBeneficiary));
        const callData = mockCallReceiver.interface.encodeFunctionData("collectTokens", [
          usdcToken.address,
          transferredAmount - executionFee
        ]);
        const tokenAddress = usdcToken.address;
        const safeTxGas = 1000000;
        // packExternalCall(executionFee, fallbackAddress, safeTxGas, executor, allowDelayedExecution, requireSuccessfullExecution, callData)
        const externalCall = packExternalCall(executionFee.toString(), fallbackAddress, safeTxGas, ZERO_ADDRESS, true, true, to, callData);
        // console.log("externalCall", externalCall);
        const txSource = await externalCallAdapter.connect(aliceAccount).receiveCall(
          orderId,
          callAuthority,
          tokenAddress, //_tokenAddress
          transferredAmount, //_transferredAmount
          externalCall,
          rewardBeneficiary //_externalCallRewardBeneficiary
        );
        //check events
        //event ExternalCallExecuted(bytes32 orderId, bool callSucceeded);
        //event ExternallCallRegistered(bytes32 key, bytes32 orderId, address tokenAddress, uint256 amount);

        const callId = getExternalCallId(
          orderId,
          callAuthority,
          tokenAddress,
          transferredAmount,
          externalCall);
        // const callIdFromContract = await externalCallAdapter.getCallId(
        //   orderId,
        //   tokenAddress,
        //   transferredAmount,
        //   to,
        //   externalCall
        // );
        // expect(callId).to.equal(callIdFromContract);

        await expectEvent.inTransaction(
          txSource.hash,
          artifacts.require('DlnExternalCallAdapter'),
          "ExternallCallRegistered",
          {
            callId: callId,
            orderId: orderId,
            tokenAddress: usdcToken.address,
            amount: transferredAmount,
            externalCall: externalCall
          }
        );
        const adapterUSDCAfter = toBn(await usdcToken.balanceOf(externalCallAdapter.address));
        const rewardBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(rewardBeneficiary));

        // console.log("adapterUSDCBefore", adapterUSDCBefore);
        // console.log("rewardBeneficiaryUSDCBefore", rewardBeneficiaryUSDCBefore);
        // console.log("adapterUSDCAfter", adapterUSDCAfter);
        // console.log("rewardBeneficiaryUSDCAfter", rewardBeneficiaryUSDCAfter);
        expect(adapterUSDCAfter.sub(adapterUSDCBefore)).to.equal(0);
        expect(rewardBeneficiaryUSDCAfter.sub(rewardBeneficiaryUSDCBefore)).to.equal(0);

        const callState = await externalCallAdapter.externalCallStatus(callId);
        expect(callState.toString()).to.equal("1"); //Created
      });
      it('Should execute call previous registered call', async () => {
        const transferredAmount = 5 * (10 ** usdcDecimals);
        const executionFee = 1 * (10 ** usdcDecimals);
        const to = mockCallReceiver.address;
        const orderId = "0xb32e4a0db32c990b4c006f367c71aa32e4dd81aac221fd25eb0b3782072ca81a";// "0x"+crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        //await usdcToken.mint(externalCallAdapter.address, transferredAmount);
        const fallbackAddress = konrad;
        const rewardBeneficiary = alex;
        const receiverUSDCBefore = toBn(await usdcToken.balanceOf(mockCallReceiver.address));
        const adapterUSDCBefore = toBn(await usdcToken.balanceOf(externalCallAdapter.address));
        const rewardBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(rewardBeneficiary));
        const callData = mockCallReceiver.interface.encodeFunctionData("collectTokens", [
          usdcToken.address,
          transferredAmount - executionFee
        ]);
        const tokenAddress = usdcToken.address;
        const safeTxGas = 1000000;
        // packExternalCall(executionFee, fallbackAddress, safeTxGas, executor, allowDelayedExecution, requireSuccessfullExecution, to, callData)
        const externalCall = packExternalCall(executionFee.toString(), fallbackAddress, safeTxGas, ZERO_ADDRESS, true, true, to, callData);

        const txSource = await externalCallAdapter.connect(bobAccount).executeCall(
          orderId,
          callAuthority,
          tokenAddress, //_tokenAddress 
          transferredAmount, //_transferredAmount
          externalCall,
          rewardBeneficiary
        );

        const callId = getExternalCallId(
          orderId,
          callAuthority,
          tokenAddress,
          transferredAmount,
          externalCall);

        // emit ExternalCallExecuted(_orderId, callSucceeded);
        await expectEvent.inTransaction(
          txSource.hash,
          artifacts.require('DlnExternalCallAdapter'),
          "ExternalCallExecuted",
          {
            orderId: orderId,
            callSucceeded: true
          }
        );
        const receiverUSDCAfter = toBn(await usdcToken.balanceOf(mockCallReceiver.address));
        const adapterUSDCAfter = toBn(await usdcToken.balanceOf(externalCallAdapter.address));
        const rewardBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(rewardBeneficiary));

        // console.log("adapterUSDCBefore", adapterUSDCBefore);
        // console.log("rewardBeneficiaryUSDCBefore", rewardBeneficiaryUSDCBefore);
        // console.log("adapterUSDCAfter", adapterUSDCAfter);
        // console.log("rewardBeneficiaryUSDCAfter", rewardBeneficiaryUSDCAfter);
        expect(receiverUSDCAfter.sub(receiverUSDCBefore)).to.equal(transferredAmount - executionFee);
        expect(adapterUSDCBefore.sub(adapterUSDCAfter)).to.equal(transferredAmount);
        expect(rewardBeneficiaryUSDCAfter.sub(rewardBeneficiaryUSDCBefore)).to.equal(executionFee);

        const callState = await externalCallAdapter.externalCallStatus(callId);
        expect(callState.toString()).to.equal("2"); //Executed
      });

      it('Should allow call authority to cancel call', async () => {
        const transferredAmount = 5 * (10 ** usdcDecimals);
        const executionFee = 1 * (10 ** usdcDecimals);
        const to = mockCallReceiver.address;
        const orderId = "0x1c1e89c2626e2bc6eaa8f1db6f9b5a54e3d67006c8a3f9a8484b743566695ab6";
        const callAuthority = alice;
        await usdcToken.mint(externalCallAdapter.address, transferredAmount);
        const fallbackAddress = konrad;
        const rewardBeneficiary = ZERO_ADDRESS;
        const callData = mockCallReceiver.interface.encodeFunctionData("collectTokens", [
          usdcToken.address,
          transferredAmount - executionFee
        ]);
        const tokenAddress = usdcToken.address;
        const safeTxGas = 1000000;
        // packExternalCall(executionFee, fallbackAddress, safeTxGas, executor, allowDelayedExecution, requireSuccessfullExecution, callData)
        const externalCall = packExternalCall(executionFee.toString(), fallbackAddress, safeTxGas, ZERO_ADDRESS, true, true, to, callData);
        const externalCallHash = ethers.utils.solidityKeccak256(['bytes'], [externalCall]);

        // register call
        const txRegister = await externalCallAdapter.connect(aliceAccount).receiveCall(
          orderId,
          callAuthority,
          tokenAddress, //_tokenAddress
          transferredAmount, //_transferredAmount
          externalCall,
          rewardBeneficiary //_externalCallRewardBeneficiary
        );

        const callId = getExternalCallId(
          orderId,
          callAuthority,
          tokenAddress,
          transferredAmount,
          externalCall);

        const adapterUSDCBefore = toBn(await usdcToken.balanceOf(externalCallAdapter.address));
        const fallbackUSDCBefore = toBn(await usdcToken.balanceOf(fallbackAddress));

        // only call athority can call cancelCall
        await expect(externalCallAdapter.connect(bobAccount).cancelCall(
          orderId,
          callAuthority,
          tokenAddress, //_tokenAddress
          transferredAmount, //_transferredAmount
          fallbackAddress,
          externalCallHash
        ))
          .to.be.revertedWithCustomError(externalCallAdapter, "BadRole");


        const txCancel = await externalCallAdapter.connect(aliceAccount).cancelCall(
          orderId,
          callAuthority,
          tokenAddress, //_tokenAddress
          transferredAmount, //_transferredAmount
          fallbackAddress,
          externalCallHash
        );

        // emit ExternalCallExecuted(_orderId, callSucceeded);
        await expectEvent.inTransaction(
          txCancel.hash,
          artifacts.require('DlnExternalCallAdapter'),
          "ExternalCallCancelled",
          {
            orderId: orderId
          }
        );

        const adapterUSDCAfter = toBn(await usdcToken.balanceOf(externalCallAdapter.address));
        const fallbackUSDCAfter = toBn(await usdcToken.balanceOf(fallbackAddress));

        expect(fallbackUSDCAfter.sub(fallbackUSDCBefore)).to.equal(transferredAmount);
        expect(adapterUSDCBefore.sub(adapterUSDCAfter)).to.equal(transferredAmount);
        const callState = await externalCallAdapter.externalCallStatus(callId);
        expect(callState.toString()).to.equal("3"); //Cancelled
      });
      it('Should fail if unknown call will execute', async () => {
        const orderId = "0x" + crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        const rewardBeneficiary = alex;
        const externalCall = "0x112233";
        const tokenAddress = usdcToken.address;
        const transferredAmount = 122344;
        const to = mockCallReceiver.address;

        await expect(externalCallAdapter.connect(bobAccount).executeCall(
          orderId,
          callAuthority,
          tokenAddress,
          transferredAmount,
          externalCall,
          rewardBeneficiary
        ))
          .to.be.revertedWithCustomError(externalCallAdapter, "InvalideState");
      });

      it('Should fail if unknown call will cancel', async () => {
        const orderId = "0x" + crypto.randomBytes(32).toString('hex');
        const callAuthority = alice;
        const rewardBeneficiary = alex;
        const externalCallHash = "0x" + crypto.randomBytes(32).toString('hex');
        const tokenAddress = usdcToken.address;
        const transferredAmount = 122344;
        const to = mockCallReceiver.address;

        await expect(externalCallAdapter.connect(aliceAccount).cancelCall(
          orderId,
          callAuthority,
          tokenAddress, //_tokenAddress
          transferredAmount, //_transferredAmount
          rewardBeneficiary,
          externalCallHash
        ))
          .to.be.revertedWithCustomError(externalCallAdapter, "InvalideState");
      });
    });
  });


  context("Admin methods", () => {
    it('Admin should set executor', async () => {
      const testAddress = "0x1111111111111111111111111111111111111111";
      const txSource = await externalCallAdapter.updateExecutor(testAddress);
      //check events
      //event ExecutorUpdated(address oldExecutor, address newExecutor);
      await expectEvent.inTransaction(
        txSource.hash,
        artifacts.require('DlnExternalCallAdapter'),
        "ExecutorUpdated",
        {
          oldExecutor: externalCallExecutor.address,
          newExecutor: testAddress,
        }
      );
    });

    context("Should reject if called by not admin", () => {
      it('Should reject if not admin try set Executor', async () => {
        const testAddress = "0x1111111111111111111111111111111111111111";
        await expect(externalCallAdapter.connect(bobAccount).updateExecutor(testAddress))
          .to.be.revertedWithCustomError(externalCallAdapter, "AdminBadRole");
      });
    });
  });

  context("Executor methods", () => {

  });


  context("Validation in externalCallExecutor", () => {
    it("Check validation for prohibited function selectors", async function () {
      const prohibitedData = [
        "0x095ea7b3",
        "0x095ea7b311223344",
        "0x23b872dd",
        "0xa9059cbb",
        "0x39509351",
      ];


      const incorrectData = [
        "0x095e",
        "0x09"
      ];
      const correctData = ["0x7040de94000000000000000000000000000000000000000000000000000000000000002200",
        "0x4d8160ba000000000000000000000000af88d065e77c8cc2239327c5edb3a432"];

      // Test with prohibited data
      for (const data of prohibitedData) {
        const isProhibitedSelector = await externalCallExecutor.isProhibitedSelector(data);
        expect(isProhibitedSelector).to.equal(true, `Prohibited data ${data} should be invalid`);
      }

      // Test with incorrect data
      for (const data of incorrectData) {
        await expect(externalCallExecutor.isProhibitedSelector(data)).to.be.revertedWith("toBytes4_outOfBounds");
      }

      // Test with correct data
      for (const data of correctData) {
        const isProhibitedSelector = await externalCallExecutor.isProhibitedSelector(data);
        expect(isProhibitedSelector).to.equal(false, `Correct data ${data} should be valid`);
      }
    });
  });
});