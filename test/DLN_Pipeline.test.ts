import { artifacts, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { MockDlnDestination, MockToken, MockDeBridgeGate, DlnSource } from "../typechain-types";
const debridgeInitParams = require("../assets/debridgeInitParams");
import Web3 from "web3";
import expectEvent from "./utils/expectEventFork";
import { decodeAutoParamsTo, packExternalCall, packSubmissionAutoParamsFrom } from "./utils.spec";
import { toBn } from "./utils/toBn";

import { BSC_CHAIN_ID, createCoreContract, deployAs, ETH_CHAIN_ID } from './utils/configureCore';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

// type DlnSourceMock = MockContract & {mock: { [K in keyof DlnSource['functions']]: Stub }};
// type DlnDestinationMock = MockContract & {mock: { [K in keyof DlnDestination['functions']]: Stub }};

const ZERO_ADDRESS = ethers.constants.AddressZero;
const BPS_DENOMINATOR = 10000;
const GLOBAL_TRANSFER_FEE_BPS = 10;
const usdcDecimals = 6;
const busdDecimals = 18;
const ETHDecimals = 18;

const EVM_TYPE = 1;
const SOLANA_TYPE = 2;
const SOLANA_CHAIN_ID = 7565164;
const SOLANA_SOURCE_ADDRESS = 0x0d0720cc7c6605b7736c08b95ad98d6b67f2da0ede7eff702e76a173c18e9d36;
const SOLANA_DESTINATION_ADDRESS = 0xc2f92a89be5ad0b3149585e66e312b643677fc0302a452e36d0211d803a01cc7;

interface IOrder {
  makerOrderNonce: BigNumber;
  makerSrc: string;
  giveChainId: BigNumber;
  giveTokenAddress: string;
  giveAmount: BigNumber;
  takeChainId: BigNumber ;
  takeTokenAddress: string;
  takeAmount: BigNumber;
  receiverDst: string;
  givePatchAuthoritySrc:string;
  orderAuthorityAddressDst:string;
  allowedTakerDst: string;
  allowedCancelBeneficiarySrc: string;
  externalCall: string;
}

describe('DLN Source', () => {
  let createOrderDTO;
  let affiliateFeeBeneficiary: string;
  let affiliateFeeAmount: number;
  let affiliateFeeEncoded: string;
  let currentOrderId: string;
  let currentOrder: IOrder;

  let makerOrderNonce: number;

  let [deployerAccount, aliceAccount, bobAccount, konradAccount, affilatedAccount]: SignerWithAddress[] = [];
  let [deployer, alice, bob, konrad, affiliatedAddress]: string[] = [];
  let dlnSourceEth: DlnSource;
  let dlnSourceBSC: DlnSource;
  let dlnDestinationETH: MockDlnDestination;
  let dlnDestinationBSC: MockDlnDestination;
  let usdcToken: MockToken;
  let busdToken: MockToken;

  let deBridgeGateETH: MockDeBridgeGate;
  let deBridgeGateBSC: MockDeBridgeGate;

  const deployInitParamsETH = debridgeInitParams['ETH'];
  const deployInitParamsBSC = debridgeInitParams['BSC'];

  before(async () => {
    [deployerAccount, aliceAccount, bobAccount, konradAccount, affilatedAccount] = await ethers.getSigners();

    deployer = deployerAccount.address;
    alice = aliceAccount.address;
    bob = bobAccount.address;
    konrad = konradAccount.address;
    affiliatedAddress = affilatedAccount.address;

    // #region core cotracts
    const { deBridgeGateETH: _deBridgeGateETH, deBridgeGateBSC: _deBridgeGateBSC } = await createCoreContract(deployerAccount);
    deBridgeGateETH = _deBridgeGateETH;
    deBridgeGateBSC = _deBridgeGateBSC;

    // #endregion core cotracts

    const mockDlnSourceFactory = await ethers.getContractFactory("MockDlnSource", deployer);
    const mockDlnDestinationFactory = await ethers.getContractFactory("MockDlnDestination", deployer);

    dlnSourceEth = await upgrades.deployProxy(
      mockDlnSourceFactory,
      [
        deBridgeGateETH.address,
        deployInitParamsETH.globalFixedNativeFee,
        deployInitParamsETH.globalTransferFeeBps,
        ETH_CHAIN_ID
      ],
      {
        initializer: "initializeMock",
        kind: "transparent",
      }
    ) as DlnSource;
    dlnDestinationETH = await upgrades.deployProxy(
      mockDlnDestinationFactory,
      [
        deBridgeGateETH.address,
        ETH_CHAIN_ID
      ],
      {
        initializer: "initializeMock",
        kind: "transparent",
      }
    ) as MockDlnDestination;

    dlnSourceBSC = await upgrades.deployProxy(
      mockDlnSourceFactory,
      [
        deBridgeGateBSC.address,
        deployInitParamsBSC.globalFixedNativeFee,
        deployInitParamsBSC.globalTransferFeeBps,
        BSC_CHAIN_ID
      ],
      {
        initializer: "initializeMock",
        kind: "transparent",
      }
    ) as DlnSource;
    dlnDestinationBSC = await upgrades.deployProxy(
      mockDlnDestinationFactory,
      [
        deBridgeGateBSC.address,
        BSC_CHAIN_ID
      ],
      {
        initializer: "initializeMock",
        kind: "transparent",
      }
    ) as MockDlnDestination;

    // configure tokens
    usdcToken = await deployAs(deployerAccount, 'MockToken', "USD Coin", "USDC", usdcDecimals) as MockToken;
    busdToken = await deployAs(deployerAccount, 'MockToken', "Binance-Peg BUSD Token", "Cake", busdDecimals) as MockToken;
    const mintUsdcAmount = 1000 * (10 ** usdcDecimals);
    await usdcToken.mint(alice, mintUsdcAmount);
    await usdcToken.connect(aliceAccount).approve(dlnSourceEth.address, mintUsdcAmount);

    const mintBusdAmount = Web3.utils.toWei("1000");
    await busdToken.mint(bob, mintBusdAmount);
    await busdToken.connect(bobAccount).approve(dlnDestinationBSC.address, mintBusdAmount);
  });

  const getGiveAmountAfterFee = (giveAmount: string | number): string => {
    const commission = toBn(giveAmount).mul(deployInitParamsETH.globalTransferFeeBps).div(BPS_DENOMINATOR);
    return toBn(giveAmount).sub(commission).toString();
  }
  const createOrder = async (permit: string = '0x') : Promise<{ orderId: string, order: IOrder}> => {
    if (makerOrderNonce === undefined) {
      makerOrderNonce = 0;
    } else {
      makerOrderNonce++;
    }
    createOrderDTO = {
      giveTokenAddress: usdcToken.address,
      giveAmount: 10 * 10 ** usdcDecimals,
      takeTokenAddress: busdToken.address,
      takeAmount: Web3.utils.toWei("10"),
      takeChainId: BSC_CHAIN_ID,
      receiverDst: alice,
      givePatchAuthoritySrc: alice,
      /// If the field is `Some`, then only this address can receive cancel
      orderAuthorityAddressDst: alice,
      /// allowedTakerDst * optional
      allowedTakerDst: "0x",
      /// externalCall * optional
      externalCall: "0x",
      /// Address in source chain
      /// If the field is `Some`, then only this address can receive cancel
      /// * optional
      allowedCancelBeneficiarySrc: "0x",
    };

    affiliateFeeAmount = 1 * 10 ** usdcDecimals;
    affiliateFeeBeneficiary = affiliatedAddress;

    affiliateFeeEncoded = new Web3().utils.encodePacked(
      { value: affiliateFeeBeneficiary.toString(), type: 'address' },
      { value: affiliateFeeAmount.toString(), type: 'uint256' }
    );

    const contractETHBefore = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
    // const aliceETHBefore =  toBn(await waffle.provider.getBalance(alice));

    const contractUSDCBefore = toBn(await usdcToken.balanceOf(dlnSourceEth.address));
    const aliceUSDCBefore = toBn(await usdcToken.balanceOf(alice));


    const tx = await dlnSourceEth.connect(aliceAccount).createOrder(
      createOrderDTO,
      affiliateFeeEncoded,
      1, //_referralCode
      permit, //_permit
      { value: deployInitParamsETH.globalFixedNativeFee });
    const receiptSend = await tx.wait();
    // console.log(receiptSend);

    const contractETHAfter = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
    // const aliceETHAfter =  toBn(await waffle.provider.getBalance(alice));

    const contractUSDCAfter = toBn(await usdcToken.balanceOf(dlnSourceEth.address));
    const aliceUSDCAfter = toBn(await usdcToken.balanceOf(alice));

    expect(contractETHAfter.sub(contractETHBefore)).to.equal(deployInitParamsETH.globalFixedNativeFee);
    expect(contractUSDCAfter.sub(contractUSDCBefore)).to.equal(createOrderDTO.giveAmount);

    const newOrderEvent = (
      await dlnSourceEth.queryFilter(dlnSourceEth.filters.CreatedOrder(), receiptSend.blockNumber)
    )[0];
    // console.log("newOrderEvent", newOrderEvent);
    // console.log("getGiveAmountAfterFee", getGiveAmountAfterFee(createOrderDTO.giveAmount));

    currentOrderId = newOrderEvent.args.orderId;
    currentOrder = newOrderEvent.args.order;

    await expectEvent.inTransaction(
      tx.hash,
      artifacts.require('DlnSource'),
      "CreatedOrder",
      {
        // Order order, bytes32 orderId, uint32 referralCode
        order: {
          giveChainId: ETH_CHAIN_ID,
          makerOrderNonce,
          makerSrc: alice.toLowerCase(),
          giveTokenAddress: createOrderDTO.giveTokenAddress,
          // giveAmount: getGiveAmountAfterFee(toBn(createOrderDTO.giveAmount).sub(affiliateFeeAmount).toString()),
          takeTokenAddress: createOrderDTO.takeTokenAddress,
          takeAmount: createOrderDTO.takeAmount,
          takeChainId: createOrderDTO.takeChainId,
          receiverDst: createOrderDTO.receiverDst,
          givePatchAuthoritySrc: createOrderDTO.givePatchAuthoritySrc,
          /// If the field is `Some`, then only this address can receive cancel
          orderAuthorityAddressDst: createOrderDTO.orderAuthorityAddressDst,
          /// allowedTakerDst * optional
          allowedTakerDst: createOrderDTO.allowedTakerDst,
          /// externalCall * optional
          externalCall: createOrderDTO.externalCall,
          /// Address in source chain
          /// If the field is `Some`, then only this address can receive cancel
          /// * optional
          allowedCancelBeneficiarySrc: createOrderDTO.allowedCancelBeneficiarySrc,
        },
        referralCode: 1
      }
    );
    return {orderId: newOrderEvent.args.orderId, order: newOrderEvent.args.order};
  };

  /// Create native order ETH=>BNB
  const createNativeOrder = async (permit: string = '0x') => {
    if (makerOrderNonce === undefined) {
      makerOrderNonce = 0;
    } else {
      makerOrderNonce++;
    }
    createOrderDTO = {
      giveTokenAddress: ZERO_ADDRESS,
      giveAmount: Web3.utils.toWei("10"),
      takeTokenAddress: ZERO_ADDRESS,
      takeAmount: Web3.utils.toWei("3"),
      takeChainId: BSC_CHAIN_ID,
      receiverDst: alice,
      givePatchAuthoritySrc: alice,
      /// If the field is `Some`, then only this address can receive cancel
      orderAuthorityAddressDst: alice,
      /// allowedTakerDst * optional
      allowedTakerDst: "0x",
      /// externalCall * optional
      externalCall: "0x",
      /// Address in source chain
      /// If the field is `Some`, then only this address can receive cancel
      /// * optional
      allowedCancelBeneficiarySrc: "0x",
    };

    affiliateFeeAmount = 1 * 10 ** ETHDecimals;
    affiliateFeeBeneficiary = affiliatedAddress;

    affiliateFeeEncoded = new Web3().utils.encodePacked(
      { value: affiliateFeeBeneficiary.toString(), type: 'address' },
      { value: affiliateFeeAmount.toString(), type: 'uint256' }
    );

    const contractETHBefore = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
    const aliceETHBefore = toBn(await ethers.provider.getBalance(alice));

    const sendETHValue = toBn(deployInitParamsETH.globalFixedNativeFee).add(createOrderDTO.giveAmount);
    const tx = await dlnSourceEth.connect(aliceAccount).createOrder(
      createOrderDTO,
      affiliateFeeEncoded,
      1, //_referralCode
      permit, //_permit
      { value: sendETHValue });
    const receiptSend = await tx.wait();


    const contractETHAfter = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
    const aliceETHAfter = toBn(await ethers.provider.getBalance(alice));


    expect(contractETHAfter.sub(contractETHBefore)).to.equal(sendETHValue);

    // alice paid for tx. could find diff.
    // console.log("sendETHValue", sendETHValue);
    // expect(aliceETHBefore.sub(aliceETHAfter)).to.equal(sendETHValue);

    const newOrderEvent = (
      await dlnSourceEth.queryFilter(dlnSourceEth.filters.CreatedOrder(), receiptSend.blockNumber)
    )[0];
    // console.log("newOrderEvent", newOrderEvent);

    currentOrderId = newOrderEvent.args.orderId;
    currentOrder = newOrderEvent.args.order;

    await expectEvent.inTransaction(
      tx.hash,
      artifacts.require('DlnSource'),
      "CreatedOrder",
      {
        // Order order, bytes32 orderId, uint32 referralCode
        order: {
          giveChainId: ETH_CHAIN_ID,
          makerOrderNonce,
          makerSrc: alice.toLowerCase(),
          giveTokenAddress: createOrderDTO.giveTokenAddress,
          // giveAmount: getGiveAmountAfterFee(toBn(createOrderDTO.giveAmount).sub(affiliateFeeAmount).toString()),
          takeTokenAddress: createOrderDTO.takeTokenAddress,
          takeAmount: createOrderDTO.takeAmount,
          takeChainId: createOrderDTO.takeChainId,
          receiverDst: createOrderDTO.receiverDst,
          givePatchAuthoritySrc: createOrderDTO.givePatchAuthoritySrc,
          /// If the field is `Some`, then only this address can receive cancel
          orderAuthorityAddressDst: createOrderDTO.orderAuthorityAddressDst,
          /// allowedTakerDst * optional
          allowedTakerDst: createOrderDTO.allowedTakerDst,
          /// externalCall * optional
          externalCall: createOrderDTO.externalCall,
          /// Address in source chain
          /// If the field is `Some`, then only this address can receive cancel
          /// * optional
          allowedCancelBeneficiarySrc: createOrderDTO.allowedCancelBeneficiarySrc,
        },
        referralCode: 1
      }
    );
  };

  context("Configure contracts", () => {
    it('Check init contract params', async () => {
      // ETH
      expect((await dlnSourceEth.deBridgeGate()).toString()).to.equal(deBridgeGateETH.address);
      expect((await dlnSourceEth.globalFixedNativeFee()).toString()).to.equal(deployInitParamsETH.globalFixedNativeFee);
      expect((await dlnSourceEth.globalTransferFeeBps()).toString()).to.equal(deployInitParamsETH.globalTransferFeeBps);
      expect(await dlnDestinationETH.deBridgeGate()).to.equal(deBridgeGateETH.address);
      // BSC
      expect((await dlnSourceBSC.deBridgeGate()).toString()).to.equal(deBridgeGateBSC.address);
      expect((await dlnSourceBSC.globalFixedNativeFee()).toString()).to.equal(deployInitParamsBSC.globalFixedNativeFee);
      expect((await dlnSourceBSC.globalTransferFeeBps()).toString()).to.equal(deployInitParamsBSC.globalTransferFeeBps);
      expect(await dlnDestinationBSC.deBridgeGate()).to.equal(deBridgeGateBSC.address);
    });

    it('Set DLN source/destination addresses', async () => {
      // ETH
      await dlnSourceEth.setDlnDestinationAddress(BSC_CHAIN_ID, dlnDestinationBSC.address, EVM_TYPE);
      await dlnDestinationETH.setDlnSourceAddress(BSC_CHAIN_ID, dlnSourceBSC.address, EVM_TYPE);
      expect(await dlnSourceEth.dlnDestinationAddresses(BSC_CHAIN_ID)).to.equal(dlnDestinationBSC.address.toLowerCase());
      expect(await dlnDestinationETH.dlnSourceAddresses(BSC_CHAIN_ID)).to.equal(dlnSourceBSC.address.toLowerCase());

      // BSC
      await dlnSourceBSC.setDlnDestinationAddress(ETH_CHAIN_ID, dlnDestinationETH.address, EVM_TYPE);
      await dlnDestinationBSC.setDlnSourceAddress(ETH_CHAIN_ID, dlnSourceEth.address, EVM_TYPE);
      expect(await dlnSourceBSC.dlnDestinationAddresses(ETH_CHAIN_ID)).to.equal(dlnDestinationETH.address.toLowerCase());
      expect(await dlnDestinationBSC.dlnSourceAddresses(ETH_CHAIN_ID)).to.equal(dlnSourceEth.address.toLowerCase());
    });

    it('Set setMaxOrderCountsPerBatch in DLNdestination', async () => {
      const maxOrderCountPerBatchEvmUnlock = 11;
      const maxOrderCountPerBatchSolanaUnlock = 10;

      expect(await dlnDestinationETH.maxOrderCountPerBatchEvmUnlock()).to.equal(0);
      expect(await dlnDestinationETH.maxOrderCountPerBatchSolanaUnlock()).to.equal(0);

      // ETH
      await dlnDestinationETH.setMaxOrderCountsPerBatch(maxOrderCountPerBatchEvmUnlock, maxOrderCountPerBatchSolanaUnlock);
      expect(await dlnDestinationETH.maxOrderCountPerBatchEvmUnlock()).to.equal(maxOrderCountPerBatchEvmUnlock);
      expect(await dlnDestinationETH.maxOrderCountPerBatchSolanaUnlock()).to.equal(maxOrderCountPerBatchSolanaUnlock);

      // BSC
      await dlnDestinationBSC.setMaxOrderCountsPerBatch(maxOrderCountPerBatchEvmUnlock, maxOrderCountPerBatchSolanaUnlock);
      expect(await dlnDestinationBSC.maxOrderCountPerBatchEvmUnlock()).to.equal(maxOrderCountPerBatchEvmUnlock);
      expect(await dlnDestinationBSC.maxOrderCountPerBatchSolanaUnlock()).to.equal(maxOrderCountPerBatchSolanaUnlock);
    });    
  });

  context("Test check error", () => {
    let affiliateFeeEncoded;
    beforeEach(async () => {
      createOrderDTO = {
        giveTokenAddress: usdcToken.address,
        giveAmount: 10 * 10 ** usdcDecimals,
        takeTokenAddress: busdToken.address,
        takeAmount: Web3.utils.toWei("10"),
        takeChainId: BSC_CHAIN_ID,
        receiverDst: alice,
        givePatchAuthoritySrc: alice,
        /// If the field is `Some`, then only this address can receive cancel
        orderAuthorityAddressDst: alice,
        /// allowedTakerDst * optional
        allowedTakerDst: "0x",
        /// externalCall * optional
        externalCall: "0x",
        /// Address in source chain
        /// If the field is `Some`, then only this address can receive cancel
        /// * optional
        allowedCancelBeneficiarySrc: "0x",
      };

      affiliateFeeEncoded = new Web3().utils.encodePacked(
        { value: bob.toString(), type: 'address' }, //beneficiary
        { value: (1 * 10 ** usdcDecimals).toString(), type: 'uint256' } //amount
      );

    });
    // it('should be 0 balance', async () => {
    //   const contractBalance = await ethers.provider.getBalance(pmmEth.address);
    //   expect(contractBalance).to.be.equal(0);
    // });

    it('should test WrongFixedFee in CreateOrder', async () => {
      let currentOrderDTO = { ...createOrderDTO };
      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: 100 })
      ).to.be.revertedWithCustomError(
        dlnSourceEth,
        'WrongFixedFee'
      ).withArgs('100', debridgeInitParams['ETH'].globalFixedNativeFee);
    });

    // it('should test globalFixedNativeFee is 10000000000000000', async () => {
    //   expect((await pmmEth.globalFixedNativeFee()).toString()).to.be.equal('10000000000000000');
    // });

    it.skip('should test ExternalCallIsBlocked in CreateOrder', async () => {
      let currentOrderDTO = { ...createOrderDTO };
      currentOrderDTO.externalCall = "0xa9059cbb";

      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: deployInitParamsETH.globalFixedNativeFee })
      ).to.be.revertedWithCustomError(dlnSourceEth, 'ExternalCallIsBlocked');
    });


    // it.skip('should test ProposedFeeTooHigh in ValidateOrder', async () => {
    //   let currentOrderDTO = { ...createOrderDTO };
    //   currentOrderDTO.externalCall = packExternalCall(toBn(currentOrderDTO.takeAmount).add(10).toString(), konrad, '0x');
    //   await expect(dlnSourceEth.connect(aliceAccount).validateCreationOrder(
    //     currentOrderDTO,
    //     bob,
    //   )).to.be.revertedWith("ProposedFeeTooHigh()");
    // });

    // it.skip('should test WrongAddressLength in ValidateOrder ExternalCallData', async () => {
    //   let currentOrderDTO = { ...createOrderDTO };
    //   currentOrderDTO.externalCall = packExternalCall('1000', alice + 'aa', '0x11');
    //   await expect(dlnSourceEth.connect(aliceAccount).validateCreationOrder(
    //     currentOrderDTO,
    //     bob,
    //   )).to.be.revertedWith("WrongAddressLength()");
    // });

    it('should test WrongAddressLength in CreateOrder', async () => {
      let currentOrderDTO = { ...createOrderDTO };
      currentOrderDTO.receiverDst = alice + "ff"; // change lenght of dst address
      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: deployInitParamsETH.globalFixedNativeFee })
      ).to.be.revertedWithCustomError(dlnSourceEth, 'WrongAddressLength')

      currentOrderDTO = { ...createOrderDTO };
      currentOrderDTO.orderAuthorityAddressDst = alice + "ff"; // change lenght of dst address
      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: deployInitParamsETH.globalFixedNativeFee })
      ).to.be.revertedWithCustomError(dlnSourceEth, 'WrongAddressLength')

      currentOrderDTO = { ...createOrderDTO };
      currentOrderDTO.takeTokenAddress = busdToken.address + "ff"; // change lenght of dst address
      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: deployInitParamsETH.globalFixedNativeFee })
      ).to.be.revertedWithCustomError(dlnSourceEth, 'WrongAddressLength')

      currentOrderDTO = { ...createOrderDTO };
      currentOrderDTO.allowedTakerDst = alice + 'aa'; // change lenght of dst address
      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: deployInitParamsETH.globalFixedNativeFee })
      ).to.be.revertedWithCustomError(dlnSourceEth, 'WrongAddressLength')

      currentOrderDTO = { ...createOrderDTO };
      currentOrderDTO.allowedCancelBeneficiarySrc = alice + 'aa'; // change lenght of dst address
      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        currentOrderDTO,
        affiliateFeeEncoded,
        0, //_referralCode
        "0x", //_permit
        { value: deployInitParamsETH.globalFixedNativeFee })
      ).to.be.revertedWithCustomError(dlnSourceEth, 'WrongAddressLength')

      //TODO: check other properties lenght , fallbackAddress when external call wiil be enabled
    });

    it('Unauthorized in SendEvmOrderCancel', async () => {
      await createOrder();
      await expect(dlnDestinationBSC.connect(bobAccount).sendEvmOrderCancel(
        currentOrder, // _order
        bobAccount.address,
        '1000'
      )).to.be.revertedWithCustomError(dlnDestinationBSC, 'Unauthorized')
    });

    it('TransferAmountNotCoverFees in SendEvmOrderCancel', async () => {
      await expect(dlnDestinationBSC.connect(aliceAccount).sendEvmOrderCancel(
        currentOrder, // _order
        bobAccount.address,
        '1000'
      )).to.be.revertedWithCustomError(dlnDestinationBSC, 'TransferAmountNotCoverFees')
    });

    it('WrongChain in patchOrderTake DLN Destination', async () => {
      await expect(dlnDestinationBSC.connect(aliceAccount).patchOrderTake({ ...currentOrder, takeChainId: 1, }, 100000))
        .to.be.revertedWithCustomError(dlnDestinationBSC, 'WrongChain')
    });

    it('Unauthorized in patchOrderTake DLN Destination', async () => {
      await expect(dlnDestinationBSC.connect(bobAccount).patchOrderTake(currentOrder, 100000))
        .to.be.revertedWithCustomError(dlnDestinationBSC, 'Unauthorized')
    });

    it('WrongArgument in patchOrderTake DLN Destination', async () => {
      await dlnDestinationBSC.connect(aliceAccount).patchOrderTake(currentOrder, 1000000);
      await expect(dlnDestinationBSC.connect(aliceAccount).patchOrderTake(currentOrder, 100000))
        .to.be.revertedWithCustomError(dlnDestinationBSC, 'WrongArgument')
    });

    it('WrongArgument in patchOrderTake DLN Destination', async () => {
      await expect(dlnDestinationBSC.connect(aliceAccount).patchOrderTake(currentOrder, currentOrder.takeAmount))
        .to.be.revertedWithCustomError(dlnDestinationBSC, 'WrongArgument')
    });

    it('IncorrectOrderStatus in patchOrderTake DLN Destination', async () => {
      await dlnDestinationBSC.connect(aliceAccount).sendEvmOrderCancel(
        currentOrder, // _order
        konrad,
        '0',
        { value: Web3.utils.toWei('1') }
      )
      await expect(dlnDestinationBSC.connect(aliceAccount).patchOrderTake(currentOrder, 10000000))
        .to.be.revertedWithCustomError(dlnDestinationBSC, 'IncorrectOrderStatus')
    });

    it('Unauthorized in patchOrderGive DLN Source', async () => {
      await expect(dlnSourceEth.connect(bobAccount).patchOrderGive(currentOrder, 100000, '0x'))
        .to.be.revertedWithCustomError(dlnSourceEth, 'Unauthorized')
    });

    it('WrongArgument in patchOrderGive DLN Source', async () => {
      await expect(dlnSourceEth.connect(aliceAccount).patchOrderGive(currentOrder, 0, '0x'))
        .to.be.revertedWithCustomError(dlnSourceEth, 'WrongArgument')
    });

    it('IncorrectOrderStatus in patchOrderGive DLN Source', async () => {
      //makerOrderNonce for get not set status
      await expect(dlnSourceEth.connect(aliceAccount).patchOrderGive({ ...currentOrder, makerOrderNonce: 1000 }, 1990, '0x'))
        .to.be.revertedWithCustomError(dlnSourceEth, 'IncorrectOrderStatus')
    });
  });

  context("Send ERC20 from Ethereum to BSC", () => {

    it('Create order from Ethereum to BSC', createOrder);

    it('Fulfill order in BSC', async () => {
      const aliceBusdBefore = toBn(await busdToken.balanceOf(currentOrder.receiverDst));
      //
      // console.log("currentOrder", currentOrder);
      // console.log("currentOrderId", currentOrderId);
      const tx = await dlnDestinationBSC.connect(bobAccount).functions['fulfillOrder((uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes),uint256,bytes32,bytes,address)'](
        currentOrder, // _order
        currentOrder.takeAmount,// _fulFillAmount
        currentOrderId,
        "0x", //_permit
        bobAccount.address
      );
      const receiptFulFill = await tx.wait();
      // console.log(receiptSend);

      const aliceBusdAfter = toBn(await busdToken.balanceOf(currentOrder.receiverDst));

      expect(aliceBusdAfter.sub(aliceBusdBefore)).to.equal(currentOrder.takeAmount);

      const fulFillEvent = (
        await dlnDestinationBSC.queryFilter(dlnDestinationBSC.filters.FulfilledOrder(), receiptFulFill.blockNumber)
      )[0];
      // console.log(fulFillEvent);
      // event FulfilledOrder(Order order, bytes32 orderId, address sender);
      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "FulfilledOrder",
        {
          //TODO:  order: currentOrder,
          orderId: currentOrderId,
          sender: bob
        }
      );

      const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
      // enum OrderTakeStatus {
      //   NotSet, //0
      //   /// Order full filled
      //   Fulfilled, // 1
      //   /// Order full filled and unlock command sent in give.chain_id by taker
      //   SentUnlock, // 2
      //   /// Order canceled
      //   SentCancel // 3
      // }
      expect(currentOrderTakeState.status).to.equal(1);
      expect(currentOrderTakeState.takerAddress).to.equal(bob);
      expect(currentOrderTakeState.giveChainId).to.equal(ETH_CHAIN_ID);

    });

    it('Should revert if order already was fulfilled', async () => {
      await expect(dlnDestinationBSC.connect(bobAccount).functions['fulfillOrder((uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes),uint256,bytes32,bytes,address)'](
        currentOrder, // _order
        currentOrder.takeAmount,// _fulFillAmount
        currentOrderId,
        "0x", //_permit
        bobAccount.address
      )
      ).to.be.revertedWithCustomError(dlnDestinationBSC, "IncorrectOrderStatus");
    });

    it('Should reject unlocking from unauthorized address', async () => {
      const promise = dlnDestinationBSC.connect(aliceAccount).sendEvmUnlock(
        currentOrderId,
        bob,
        0,
        { value: deployInitParamsBSC.globalFixedNativeFee }
      );
      await expect(promise)
        .to.revertedWithCustomError(dlnDestinationBSC, 'Unauthorized')
    })

    it('Send unlock in BSC to Ethereum and claim in Ethereum', async () => {
      // console.log("currentOrderId", currentOrderId);
      const contractBeforeUSDC = toBn(await usdcToken.balanceOf(dlnSourceEth.address)); //30000000
      const tx = await dlnDestinationBSC.connect(bobAccount).sendEvmUnlock(
        currentOrderId,
        bob,
        0,
        { value: deployInitParamsBSC.globalFixedNativeFee }
      );
      const receiptSentUnlock = await tx.wait();

      // const sentOrderUnlockEvent = (
      //   await dlnDestinationBSC.queryFilter(dlnDestinationBSC.filters.SentOrderUnlock(), receiptSentUnlock.blockNumber)
      // )[0];
      // console.log("sentOrderUnlockEvent", sentOrderUnlockEvent);
      // event SentOrderUnlock(bytes32 orderId, bytes beneficiary);
      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "SentOrderUnlock",
        {
          orderId: currentOrderId,
          beneficiary: bob.toLowerCase()
        }
      );

      const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
      // enum OrderTakeStatus {
      //   NotSet, //0
      //   /// Order full filled
      //   Fulfilled, // 1
      //   /// Order full filled and unlock command sent in give.chain_id by taker
      //   SentUnlock, // 2
      //   /// Order canceled
      //   SentCancel // 3
      // }
      expect(currentOrderTakeState.status).to.equal(2);
      expect(currentOrderTakeState.takerAddress).to.equal(bob);
      expect(currentOrderTakeState.giveChainId).to.equal(ETH_CHAIN_ID);


      const sendEvent = (
        await deBridgeGateBSC.queryFilter(deBridgeGateBSC.filters.Sent(), receiptSentUnlock.blockNumber)
      )[0];

      const decodedAutoParams = decodeAutoParamsTo(sendEvent.args.autoParams);
      //executionFee, flags, fallbackAddress, data, nativeSender
      const encodedAutoParamsTo = packSubmissionAutoParamsFrom(
        decodedAutoParams[0].executionFee,
        decodedAutoParams[0].flags,
        decodedAutoParams[0].fallbackAddress,
        decodedAutoParams[0].data,
        sendEvent.args.nativeSender);

      const srcOrderState = await dlnSourceEth.giveOrders(currentOrderId);
      // console.log("srcOrderState", srcOrderState);

      const bobUSDCBefore = toBn(await usdcToken.balanceOf(bob));
      const affiliateFeeBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(affiliatedAddress));
      // bytes32 _debridgeId,
      // uint256 _amount,
      // uint256 _chainIdFrom,
      // address _receiver,
      // uint256 _nonce,
      // bytes calldata _signatures,
      // bytes calldata _autoParams
      let claimUnlockTx = await deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo);

      let receiptClaimUnlock = await claimUnlockTx.wait();
      const bobUSDCAfter = toBn(await usdcToken.balanceOf(bob));
      const affiliateFeeBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(affiliatedAddress));
      const contractAfterUSDC = toBn(await usdcToken.balanceOf(dlnSourceEth.address));//20010000
      const claimedUnlockEvent = (
        await dlnSourceEth.queryFilter(dlnSourceEth.filters.ClaimedUnlock(), receiptClaimUnlock.blockNumber)
      )[0];
      // console.log("claimedUnlockEvent", claimedUnlockEvent);
      //event ClaimedUnlock(bytes32 orderId, address beneficiary, uint256 giveAmount, address giveTokenAddress);
      await expectEvent.inTransaction(
        claimUnlockTx.hash,
        artifacts.require('DlnSource'),
        "ClaimedUnlock",
        {
          orderId: currentOrderId,
          beneficiary: bob,
        }
      );
      expect(claimedUnlockEvent.args.giveTokenAddress.toLowerCase()).to.equal(currentOrder.giveTokenAddress.toLowerCase());
      expect(claimedUnlockEvent.args.giveAmount).to.equal(currentOrder.giveAmount);

      const receipt = await tx.wait();

      const affiliateFeePaid = (
        await dlnSourceEth.queryFilter(dlnSourceEth.filters.AffiliateFeePaid(), receipt.blockNumber)
      )[0];

      // console.log("affiliateFeePaid", affiliateFeePaid);

      await expectEvent.inTransaction(
        claimUnlockTx.hash,
        artifacts.require('DlnSource'),
        "AffiliateFeePaid",
        {
          _orderId: currentOrderId,
          beneficiary: affiliateFeeBeneficiary,
          affiliateFee: affiliateFeeAmount,
          giveTokenAddress: createOrderDTO.giveTokenAddress.toLowerCase()
        }
      );
      expect(bobUSDCAfter).to.equal(bobUSDCBefore.add(currentOrder.giveAmount));
      expect(affiliateFeeBeneficiaryUSDCAfter).to.equal(affiliateFeeBeneficiaryUSDCBefore.add(affiliateFeeAmount));
      expect(contractAfterUSDC).to.equal(contractBeforeUSDC.sub(currentOrder.giveAmount).sub(affiliateFeeAmount));

      //SubmissionUsed
      await expect(deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo)).to.be.revertedWithCustomError(deBridgeGateETH, "SubmissionUsed");
    });

    it('SendEvmOrderCancel order in BSC', async () => {
      await createOrder();
      const tx = await dlnDestinationBSC.connect(aliceAccount).sendEvmOrderCancel(
        currentOrder, // _order
        konrad,
        '0',
        { value: Web3.utils.toWei('1') }
      );
      const receiptEvmOrderCancel = await tx.wait();

      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "SentOrderCancel",
        {
          orderId: currentOrderId,
          cancelBeneficiary: konrad.toLowerCase(),
        }
      );

      const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
      // enum OrderTakeStatus {
      //   NotSet, //0
      //   /// Order full filled
      //   Fulfilled, // 1
      //   /// Order full filled and unlock command sent in give.chain_id by taker
      //   SentUnlock, // 2
      //   /// Order canceled
      //   SentCancel // 3
      // }
      expect(currentOrderTakeState.status).to.equal(3);
      expect(currentOrderTakeState.takerAddress).to.equal(ZERO_ADDRESS);
      expect(currentOrderTakeState.giveChainId).to.equal(0);

      const sendEvent = (
        await deBridgeGateBSC.queryFilter(deBridgeGateBSC.filters.Sent(), receiptEvmOrderCancel.blockNumber)
      )[0];

      const decodedAutoParams = decodeAutoParamsTo(sendEvent.args.autoParams);
      //executionFee, flags, fallbackAddress, data, nativeSender
      const encodedAutoParamsTo = packSubmissionAutoParamsFrom(
        decodedAutoParams[0].executionFee,
        decodedAutoParams[0].flags,
        decodedAutoParams[0].fallbackAddress,
        decodedAutoParams[0].data,
        sendEvent.args.nativeSender);


      const srcOrderState = await dlnSourceEth.giveOrders(currentOrderId);
      // console.log("srcOrderState", srcOrderState);

      //const bobUSDCBefore = toBn(await usdcToken.balanceOf(bob));
      // bytes32 _debridgeId,
      // uint256 _amount,
      // uint256 _chainIdFrom,
      // address _receiver,
      // uint256 _nonce,
      // bytes calldata _signatures,
      // bytes calldata _autoParams

      const aliceUSDCBefore = toBn(await usdcToken.balanceOf(alice));
      const konradUSDCBefore = toBn(await usdcToken.balanceOf(konrad));
      const contractBeforeUSDC = toBn(await usdcToken.balanceOf(dlnSourceEth.address));

      const claimTx = await deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo);
      const receiptClaimUnlock = await claimTx.wait();
      const aliceUSDCAfter = toBn(await usdcToken.balanceOf(alice));
      const konradUSDCAfter = toBn(await usdcToken.balanceOf(konrad));
      const orderCancelEvent = (
        await dlnSourceEth.queryFilter(dlnSourceEth.filters.ClaimedOrderCancel(), receiptClaimUnlock.blockNumber)
      )[0];

      // console.log("orderCancelEvent", orderCancelEvent);
      //event ClaimedUnlock(bytes32 orderId, address beneficiary, uint256 giveAmount, address giveTokenAddress);
      await expectEvent.inTransaction(
        claimTx.hash,
        artifacts.require('DlnSource'),
        "ClaimedOrderCancel",
        {
          orderId: currentOrderId,
          beneficiary: konrad.toLowerCase(),
          giveTokenAddress: currentOrder.giveTokenAddress
        }
      );
      const contractAfterUSDC = toBn(await usdcToken.balanceOf(dlnSourceEth.address));

      expect(konradUSDCAfter).to.be.equal(konradUSDCBefore.add(contractBeforeUSDC.sub(contractAfterUSDC)));
      expect(contractAfterUSDC).to.equal(contractBeforeUSDC.sub(konradUSDCAfter).toString());
      expect(aliceUSDCAfter).to.equal(aliceUSDCBefore);
    });

    it('PatchOrderTake order in BSC', async () => {
      await createOrder();
      const newSubtrahend = 1000000;
      const tx = await dlnDestinationBSC.connect(aliceAccount).patchOrderTake(currentOrder, newSubtrahend);

      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "DecreasedTakeAmount",
        {
          orderId: currentOrderId,
          orderTakeFinalAmount: toBn(currentOrder.takeAmount).sub(newSubtrahend).toString(),
        }
      );

      const takePatch = await dlnDestinationBSC.takePatches(currentOrderId);
      await expect(takePatch).to.be.equal(newSubtrahend);
    });

    it('PatchOrderGive order in Ethereum', async () => {
      await createOrder();
      const giveAmount = 1000000;
      let tx = await dlnSourceEth.connect(aliceAccount).patchOrderGive(currentOrder, giveAmount, '0x');
      //  uint256 percentFee = (globalTransferFeeBps * _addGiveAmount) / BPS_DENOMINATOR;
      const giveAmountFee = toBn(deployInitParamsETH.globalTransferFeeBps).mul(giveAmount).div(BPS_DENOMINATOR);
      const giveAmountAfterFee = toBn(giveAmount).sub(giveAmountFee);
      //check balance
      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnSource'),
        "IncreasedGiveAmount",
        {
          orderId: currentOrderId,
          orderGiveFinalAmount: toBn(currentOrder.giveAmount).add(giveAmountAfterFee).toString()
          // TODO: CHECK finalPercentFee: ,
        }
      );

      tx = await dlnSourceEth.connect(aliceAccount).patchOrderGive(currentOrder, giveAmount, '0x');

      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnSource'),
        "IncreasedGiveAmount",
        {
          orderId: currentOrderId,
          orderGiveFinalAmount: toBn(currentOrder.giveAmount).add(giveAmountAfterFee).add(giveAmountAfterFee).toString()
          // TODO: CHECK finalPercentFee:
        }
      );

      const givePatch = await dlnSourceEth.givePatches(currentOrderId);
      await expect(givePatch).to.be.equal(giveAmountAfterFee * 2);
    });
  });


  context("Send ETH from Ethereum to BSC", () => {

    it('Create order ETH => BNB. Should revert with MismatchNativeGiveAmount if giveAmount and msg.value is different', async () => {

      var createOrderDTO = {
        giveTokenAddress: ZERO_ADDRESS,
        giveAmount: Web3.utils.toWei("10"),
        takeTokenAddress: ZERO_ADDRESS,
        takeAmount: Web3.utils.toWei("3"),
        takeChainId: BSC_CHAIN_ID,
        receiverDst: alice,
        givePatchAuthoritySrc: alice,
        /// If the field is `Some`, then only this address can receive cancel
        orderAuthorityAddressDst: alice,
        /// allowedTakerDst * optional
        allowedTakerDst: "0x",
        /// externalCall * optional
        externalCall: "0x",
        /// Address in source chain
        /// If the field is `Some`, then only this address can receive cancel
        /// * optional
        allowedCancelBeneficiarySrc: "0x",
      };


      await expect(dlnSourceEth.connect(aliceAccount).createOrder(
        createOrderDTO,
        "0x",
        1, //_referralCode
        "0x", //_permit
        // value must include globalFixedNativeFee
        { value: createOrderDTO.giveAmount }))
        .to.be.revertedWithCustomError(dlnSourceEth, "MismatchNativeGiveAmount");
    });

    it('Create order ETH => BNB. Alice lock ETH', createNativeOrder);

    it('Fulfill order in BSC. Alice must receive BNB', async () => {
      const aliceBNBBefore = toBn(await ethers.provider.getBalance(alice));
      //
      // console.log("currentOrder", currentOrder);
      // console.log("currentOrderId", currentOrderId);
      const tx = await dlnDestinationBSC.connect(bobAccount).functions['fulfillOrder((uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes),uint256,bytes32,bytes,address)'](
        currentOrder, // _order
        currentOrder.takeAmount,// _fulFillAmount
        currentOrderId,
        "0x", //_permit
        bobAccount.address,
        { value: currentOrder.takeAmount }
      );
      const receiptFulFill = await tx.wait();
      // console.log(receiptSend);

      const aliceBNBAfter = toBn(await ethers.provider.getBalance(alice));

      expect(aliceBNBAfter.sub(aliceBNBBefore)).to.equal(currentOrder.takeAmount);

      const fulFillEvent = (
        await dlnDestinationBSC.queryFilter(dlnDestinationBSC.filters.FulfilledOrder(), receiptFulFill.blockNumber)
      )[0];
      // console.log(fulFillEvent);
      // event FulfilledOrder(Order order, bytes32 orderId, address sender);
      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "FulfilledOrder",
        {
          //TODO:  order: currentOrder,
          orderId: currentOrderId,
          sender: bob
        }
      );

      const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
      // enum OrderTakeStatus {
      //   NotSet, //0
      //   /// Order full filled
      //   Fulfilled, // 1
      //   /// Order full filled and unlock command sent in give.chain_id by taker
      //   SentUnlock, // 2
      //   /// Order canceled
      //   SentCancel // 3
      // }
      expect(currentOrderTakeState.status).to.equal(1);
      expect(currentOrderTakeState.takerAddress).to.equal(bob);
      expect(currentOrderTakeState.giveChainId).to.equal(ETH_CHAIN_ID);
    });

    it('Send unlock in BSC to Ethereum and claim in Ethereum. Bob must receive ETH.', async () => {
      // console.log("currentOrderId", currentOrderId);

      const tx = await dlnDestinationBSC.connect(bobAccount).sendEvmUnlock(
        currentOrderId,
        bob,
        0,
        { value: deployInitParamsBSC.globalFixedNativeFee }
      );
      const receiptSentUnlock = await tx.wait();

      // const sentOrderUnlockEvent = (
      //   await dlnDestinationBSC.queryFilter(dlnDestinationBSC.filters.SentOrderUnlock(), receiptSentUnlock.blockNumber)
      // )[0];
      // console.log("sentOrderUnlockEvent", sentOrderUnlockEvent);
      // event SentOrderUnlock(bytes32 orderId, bytes beneficiary);
      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "SentOrderUnlock",
        {
          orderId: currentOrderId,
          beneficiary: bob.toLowerCase()
        }
      );

      const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
      // enum OrderTakeStatus {
      //   NotSet, //0
      //   /// Order full filled
      //   Fulfilled, // 1
      //   /// Order full filled and unlock command sent in give.chain_id by taker
      //   SentUnlock, // 2
      //   /// Order canceled
      //   SentCancel // 3
      // }
      expect(currentOrderTakeState.status).to.equal(2);
      expect(currentOrderTakeState.takerAddress).to.equal(bob);
      expect(currentOrderTakeState.giveChainId).to.equal(ETH_CHAIN_ID);


      const sendEvent = (
        await deBridgeGateBSC.queryFilter(deBridgeGateBSC.filters.Sent(), receiptSentUnlock.blockNumber)
      )[0];

      const decodedAutoParams = decodeAutoParamsTo(sendEvent.args.autoParams);
      //executionFee, flags, fallbackAddress, data, nativeSender
      const encodedAutoParamsTo = packSubmissionAutoParamsFrom(
        decodedAutoParams[0].executionFee,
        decodedAutoParams[0].flags,
        decodedAutoParams[0].fallbackAddress,
        decodedAutoParams[0].data,
        sendEvent.args.nativeSender);

      const srcOrderState = await dlnSourceEth.giveOrders(currentOrderId);
      // console.log("srcOrderState", srcOrderState);

      const bobETHBefore = toBn(await ethers.provider.getBalance(bob));
      const affiliateFeeBeneficiaryETHBefore = toBn(await ethers.provider.getBalance(affiliatedAddress));

      const contractETHBefore = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
      // bytes32 _debridgeId,
      // uint256 _amount,
      // uint256 _chainIdFrom,
      // address _receiver,
      // uint256 _nonce,
      // bytes calldata _signatures,
      // bytes calldata _autoParams
      let claimUnlockTx = await deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo);

      let receiptClaimUnlock = await claimUnlockTx.wait();
      const bobETHAfter = toBn(await ethers.provider.getBalance(bob));
      const affiliateFeeBeneficiaryETHAfter = toBn(await ethers.provider.getBalance(affiliatedAddress));
      const contractETHAfter = toBn(await ethers.provider.getBalance(dlnSourceEth.address));

      const claimedUnlockEvent = (
        await dlnSourceEth.queryFilter(dlnSourceEth.filters.ClaimedUnlock(), receiptClaimUnlock.blockNumber)
      )[0];
      // console.log("claimedUnlockEvent", claimedUnlockEvent);
      //event ClaimedUnlock(bytes32 orderId, address beneficiary, uint256 giveAmount, address giveTokenAddress);
      await expectEvent.inTransaction(
        claimUnlockTx.hash,
        artifacts.require('DlnSource'),
        "ClaimedUnlock",
        {
          orderId: currentOrderId,
          beneficiary: bob,
        }
      );
      expect(claimedUnlockEvent.args.giveTokenAddress.toLowerCase()).to.equal(currentOrder.giveTokenAddress.toLowerCase());
      expect(claimedUnlockEvent.args.giveAmount).to.equal(currentOrder.giveAmount);

      await expectEvent.inTransaction(
        claimUnlockTx.hash,
        artifacts.require('DlnSource'),
        "AffiliateFeePaid",
        {
          _orderId: currentOrderId,
          beneficiary: affiliateFeeBeneficiary,
          affiliateFee: affiliateFeeAmount,
          giveTokenAddress: createOrderDTO.giveTokenAddress.toLowerCase()
        }
      );
      expect(bobETHAfter).to.equal(bobETHBefore.add(currentOrder.giveAmount));
      expect(affiliateFeeBeneficiaryETHAfter.sub(affiliateFeeAmount.toString())).to.equal(affiliateFeeBeneficiaryETHBefore);
      expect(contractETHAfter).to.equal(contractETHBefore.sub(currentOrder.giveAmount).sub(affiliateFeeAmount.toString()));

      //SubmissionUsed
      await expect(deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo)).to.be.revertedWithCustomError(deBridgeGateETH, "SubmissionUsed");
    });

    it('SendEvmOrderCancel order in BSC. konrad must receive full ETH refund ', async () => {
      await createNativeOrder();
      const tx = await dlnDestinationBSC.connect(aliceAccount).sendEvmOrderCancel(
        currentOrder, // _order
        konrad,
        '0',
        { value: Web3.utils.toWei('1') }
      );
      const receiptEvmOrderCancel = await tx.wait();

      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "SentOrderCancel",
        {
          orderId: currentOrderId,
          cancelBeneficiary: konrad.toLowerCase(),
        }
      );

      const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
      // enum OrderTakeStatus {
      //   NotSet, //0
      //   /// Order full filled
      //   Fulfilled, // 1
      //   /// Order full filled and unlock command sent in give.chain_id by taker
      //   SentUnlock, // 2
      //   /// Order canceled
      //   SentCancel // 3
      // }
      expect(currentOrderTakeState.status).to.equal(3);
      expect(currentOrderTakeState.takerAddress).to.equal(ZERO_ADDRESS);
      expect(currentOrderTakeState.giveChainId).to.equal(0);

      const sendEvent = (
        await deBridgeGateBSC.queryFilter(deBridgeGateBSC.filters.Sent(), receiptEvmOrderCancel.blockNumber)
      )[0];

      const decodedAutoParams = decodeAutoParamsTo(sendEvent.args.autoParams);
      //executionFee, flags, fallbackAddress, data, nativeSender
      const encodedAutoParamsTo = packSubmissionAutoParamsFrom(
        decodedAutoParams[0].executionFee,
        decodedAutoParams[0].flags,
        decodedAutoParams[0].fallbackAddress,
        decodedAutoParams[0].data,
        sendEvent.args.nativeSender);


      const srcOrderState = await dlnSourceEth.giveOrders(currentOrderId);
      // console.log("srcOrderState", srcOrderState);

      const contractETHBefore = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
      const aliceETHBefore = toBn(await ethers.provider.getBalance(alice));
      const konradETHBefore = toBn(await ethers.provider.getBalance(konrad));

      const claimTx = await deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo);
      const receiptClaimUnlock = await claimTx.wait();

      const contractETHAfter = toBn(await ethers.provider.getBalance(dlnSourceEth.address));
      const aliceETHAfter = toBn(await ethers.provider.getBalance(alice));
      const konradETHAfter = toBn(await ethers.provider.getBalance(konrad));

      const orderCancelEvent = (
        await dlnSourceEth.queryFilter(dlnSourceEth.filters.ClaimedOrderCancel(), receiptClaimUnlock.blockNumber)
      )[0];

      // console.log("orderCancelEvent", orderCancelEvent);
      // event ClaimedUnlock(bytes32 orderId, address beneficiary, uint256 giveAmount, address giveTokenAddress);
      await expectEvent.inTransaction(
        claimTx.hash,
        artifacts.require('DlnSource'),
        "ClaimedOrderCancel",
        {
          orderId: currentOrderId,
          beneficiary: konrad.toLowerCase(),
          giveTokenAddress: currentOrder.giveTokenAddress
        }
      );

      const orderOriginalSentValue = toBn(deployInitParamsETH.globalFixedNativeFee).add(Web3.utils.toWei("10"));
      expect(konradETHAfter).to.equal(konradETHBefore.add(orderOriginalSentValue));
      expect(contractETHAfter).to.equal(contractETHBefore.sub(orderOriginalSentValue));
    });

    it('PatchOrderTake order in BSC', async () => {
      await createNativeOrder();
      const newSubtrahend = 1000000;
      const tx = await dlnDestinationBSC.connect(aliceAccount).patchOrderTake(currentOrder, newSubtrahend);

      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnDestination'),
        "DecreasedTakeAmount",
        {
          orderId: currentOrderId,
          orderTakeFinalAmount: toBn(currentOrder.takeAmount).sub(newSubtrahend).toString(),
        }
      );

      const takePatch = await dlnDestinationBSC.takePatches(currentOrderId);
      await expect(takePatch).to.be.equal(newSubtrahend);
    });

    it('PatchOrderGive order in Ethereum. Should revert with MismatchNativeGiveAmount if amount and msg.value is different', async () => {
      await createNativeOrder();
      await expect(dlnSourceEth.connect(aliceAccount).patchOrderGive(currentOrder, "2000000", '0x', { value: "1000000" }))
        .to.be.revertedWithCustomError(dlnSourceEth, "MismatchNativeGiveAmount");

    });
    it('PatchOrderGive order in Ethereum', async () => {
      await createNativeOrder();
      const giveAmount = 1000000;
      let tx = await dlnSourceEth.connect(aliceAccount).patchOrderGive(currentOrder, giveAmount, '0x', { value: giveAmount });
      const initialPercentFee = toBn(createOrderDTO.giveAmount).mul(deployInitParamsETH.globalTransferFeeBps).div(BPS_DENOMINATOR);
      const giveAmountFee = toBn(deployInitParamsETH.globalTransferFeeBps).mul(giveAmount).div(BPS_DENOMINATOR);
      const giveAmountAfterFee = toBn(giveAmount).sub(giveAmountFee);

      //check balance
      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnSource'),
        "IncreasedGiveAmount",
        {
          orderId: currentOrderId,
          orderGiveFinalAmount: toBn(currentOrder.giveAmount).add(giveAmountAfterFee).toString(),
          finalPercentFee: toBn(giveAmountFee).add(initialPercentFee).toString()
        }
      );

      tx = await dlnSourceEth.connect(aliceAccount).patchOrderGive(currentOrder, giveAmount, '0x', { value: giveAmount });

      await expectEvent.inTransaction(
        tx.hash,
        artifacts.require('DlnSource'),
        "IncreasedGiveAmount",
        {
          orderId: currentOrderId,
          orderGiveFinalAmount: toBn(currentOrder.giveAmount).add(giveAmountAfterFee).add(giveAmountAfterFee).toString(),
          finalPercentFee: toBn(giveAmountFee).add(giveAmountFee).add(initialPercentFee).toString()
        }
      );

      const givePatch = await dlnSourceEth.givePatches(currentOrderId);
      await expect(givePatch).to.be.equal(giveAmountAfterFee * 2);
    });
  });

  context("Test batch unlock", () => {
    var createdOrdersIds: string[] = [];
    var createdOrders: IOrder[] = [];
    const ordersCount = 10;

    it('Create 10 orders from Ethereum to BSC', async () => {
      for (var i = 0; i< ordersCount; i++) {
        const { orderId: _currentOrderId, order: _currentOrder } =  await createOrder();
        createdOrdersIds.push(currentOrderId);
        createdOrders.push(currentOrder);
      }
    });

    it('Fulfill orders in BSC', async () => {
      for (var i = 0; i < ordersCount; i++) {
        const currentOrder = createdOrders[i];
        const currentOrderId = createdOrdersIds[i];
        const aliceBusdBefore = toBn(await busdToken.balanceOf(currentOrder.receiverDst));

        const tx = await dlnDestinationBSC.connect(bobAccount).functions['fulfillOrder((uint64,bytes,uint256,bytes,uint256,uint256,bytes,uint256,bytes,bytes,bytes,bytes,bytes,bytes),uint256,bytes32,bytes,address)'](
          currentOrder, // _order
          currentOrder.takeAmount,// _fulFillAmount
          currentOrderId,
          "0x", //_permit
          bobAccount.address
        );
        const receiptFulFill = await tx.wait();

        const aliceBusdAfter = toBn(await busdToken.balanceOf(currentOrder.receiverDst));

        expect(aliceBusdAfter.sub(aliceBusdBefore)).to.equal(currentOrder.takeAmount);

        // const fulFillEvent = (
        //   await dlnDestinationBSC.queryFilter(dlnDestinationBSC.filters.FulfilledOrder(), receiptFulFill.blockNumber)
        // )[0];
        await expectEvent.inTransaction(
          tx.hash,
          artifacts.require('DlnDestination'),
          "FulfilledOrder",
          {
            //TODO:  order: currentOrder,
            orderId: currentOrderId,
            sender: bob
          }
        );

        const currentOrderTakeState = await dlnDestinationBSC.takeOrders(currentOrderId);
        expect(currentOrderTakeState.status).to.equal(1);
        expect(currentOrderTakeState.takerAddress).to.equal(bob);
        expect(currentOrderTakeState.giveChainId).to.equal(ETH_CHAIN_ID);
      }
    });

    it('Send batch unlock from BSC to Ethereum and claim in Ethereum', async () => {
      // console.log("currentOrderId", currentOrderId);
      const contractBeforeUSDC = toBn(await usdcToken.balanceOf(dlnSourceEth.address)); //30000000
      const tx = await dlnDestinationBSC.connect(bobAccount).sendBatchEvmUnlock(
        createdOrdersIds,
        bob,
        0,
        { value: deployInitParamsBSC.globalFixedNativeFee }
      );
      const receiptSentUnlock = await tx.wait();

      const sentOrderUnlockItems = (
        await dlnDestinationBSC.queryFilter(dlnDestinationBSC.filters.SentOrderUnlock(), receiptSentUnlock.blockNumber)
      );

      expect(sentOrderUnlockItems.length).to.equal(ordersCount);
      for(var i = 0; i < ordersCount; i++){
        const currentUnlockEvent = sentOrderUnlockItems[i].args;
        expect(currentUnlockEvent.orderId).to.equal(createdOrdersIds[i]);
        expect(currentUnlockEvent.beneficiary).to.equal( bob.toLowerCase());

        const currentOrderTakeState = await dlnDestinationBSC.takeOrders(createdOrdersIds[i]);
        expect(currentOrderTakeState.status).to.equal(2); //SentUnlock
        expect(currentOrderTakeState.takerAddress).to.equal(bob);
        expect(currentOrderTakeState.giveChainId).to.equal(ETH_CHAIN_ID);
      }

      const sendEvent = (
        await deBridgeGateBSC.queryFilter(deBridgeGateBSC.filters.Sent(), receiptSentUnlock.blockNumber)
      )[0];

      const decodedAutoParams = decodeAutoParamsTo(sendEvent.args.autoParams);
      //executionFee, flags, fallbackAddress, data, nativeSender
      const encodedAutoParamsTo = packSubmissionAutoParamsFrom(
        decodedAutoParams[0].executionFee,
        decodedAutoParams[0].flags,
        decodedAutoParams[0].fallbackAddress,
        decodedAutoParams[0].data,
        sendEvent.args.nativeSender);

      // const srcOrderState = await dlnSourceEth.giveOrders(currentOrderId);
      // console.log("srcOrderState", srcOrderState);

      const bobUSDCBefore = toBn(await usdcToken.balanceOf(bob));
      const affiliateFeeBeneficiaryUSDCBefore = toBn(await usdcToken.balanceOf(affiliatedAddress));
      // bytes32 _debridgeId,
      // uint256 _amount,
      // uint256 _chainIdFrom,
      // address _receiver,
      // uint256 _nonce,
      // bytes calldata _signatures,
      // bytes calldata _autoParams
      let claimUnlockTx = await deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo);

      let receiptClaimUnlock = await claimUnlockTx.wait();
      const bobUSDCAfter = toBn(await usdcToken.balanceOf(bob));
      const affiliateFeeBeneficiaryUSDCAfter = toBn(await usdcToken.balanceOf(affiliatedAddress));
      const contractAfterUSDC = toBn(await usdcToken.balanceOf(dlnSourceEth.address));//20010000

      const claimedUnlockItems = (
        await dlnSourceEth.queryFilter(dlnSourceEth.filters.ClaimedUnlock(), receiptClaimUnlock.blockNumber)
      );

      expect(claimedUnlockItems.length).to.equal(ordersCount);
      for(var i = 0; i < ordersCount; i++){

        const claimedUnlockEvent = claimedUnlockItems[i].args;
        expect(claimedUnlockEvent.orderId).to.equal(createdOrdersIds[i]);
        expect(claimedUnlockEvent.beneficiary.toLowerCase()).to.equal(bob.toLowerCase());


        expect(claimedUnlockEvent.giveTokenAddress.toLowerCase()).to.equal(currentOrder.giveTokenAddress.toLowerCase());
        expect(claimedUnlockEvent.giveAmount).to.equal(currentOrder.giveAmount);

        const currentOrderGiveState = await dlnSourceEth.giveOrders(createdOrdersIds[i]);
        expect(currentOrderGiveState.status).to.equal(2); //ClaimedUnlock
      }


      const sumOrdersGiveAmount = createdOrders[0].giveAmount.mul(ordersCount);
      const sumAffiliateFeeAmount = toBn(affiliateFeeAmount).mul(ordersCount);
      expect(bobUSDCAfter).to.equal(bobUSDCBefore.add(sumOrdersGiveAmount));
      expect(affiliateFeeBeneficiaryUSDCAfter).to.equal(affiliateFeeBeneficiaryUSDCBefore.add(sumAffiliateFeeAmount));
      expect(contractAfterUSDC).to.equal(contractBeforeUSDC.sub(sumOrdersGiveAmount).sub(sumAffiliateFeeAmount));

      //SubmissionUsed
      await expect(deBridgeGateETH.claim(
        sendEvent.args.debridgeId,
        sendEvent.args.amount,
        BSC_CHAIN_ID,
        sendEvent.args.receiver,
        sendEvent.args.nonce,
        "0x",//_signatures
        encodedAutoParamsTo)).to.be.revertedWithCustomError(deBridgeGateETH, "SubmissionUsed");
    });
  });

  context("Solana methods", () => {
    it('Should validate Solana rewards', async () => {
      // "globalFixedNativeFee": "1000000000000000", // 0.001 ETH

      // amount not cover fix fee
      await expect(dlnDestinationETH.validateSolanaRewards(
        Web3.utils.toWei("0.0001"), // _amount
        Web3.utils.toWei("0.0001"), // _executionFee
        "0", // _reward1
        "0", // _reward2
      ))
      .to.be.revertedWithCustomError(dlnDestinationETH, "TransferAmountNotCoverFees");

      // Amount cover all expenses
      await dlnDestinationETH.validateSolanaRewards(
        Web3.utils.toWei("0.1"), // _amount
        Web3.utils.toWei("0.0001"), // _executionFee
        "111222", // _reward1
        "222333", // _reward2
      );

      // edge cases
      const _amount = Web3.utils.toWei("0.011");
      const _executionFee = Web3.utils.toWei("0.00099");
      // fixFee = 0.001
      // transferBPS = 10

      // amount after payed fix fee is 0.01
      // amount after payed transfer fee (10 BPS 0.00001) is 0.00999
      // amount after payed execution fee is 0.009 = 9000000000000000 wei
      // (9_000_00 | 0_000_000_000 Solana use 8 decimals);

      // to be success
      await dlnDestinationETH.validateSolanaRewards(
        _amount,
        _executionFee,
        "500000", // _reward1
        "400000", // _reward2
      );
      // expect revert
      await expect(dlnDestinationETH.validateSolanaRewards(
        _amount,
        _executionFee,
        "500001", // _reward1
        "400000", // _reward2
      ))
      .to.be.revertedWithCustomError(dlnDestinationETH, "TransferAmountNotCoverFees");
    });
    // it('Should send Solana unlock', async () => {
    //   //TODO: sendSolanaUnlock
    // });
    // it('Should send Solana cancel', async () => {
    //   //TODO: sendSolanaOrderCancel
    // });
  });

  context("Admin methods", () => {
    it('Admin should set DlnDestinationAddress', async () => {
      const testAddress = "0x1111111111111111111111111111111111111111";
      const txSource = await dlnSourceEth.setDlnDestinationAddress(BSC_CHAIN_ID, testAddress, EVM_TYPE);
      //check events

      await expectEvent.inTransaction(
        txSource.hash,
        artifacts.require('DlnSource'),
        "SetDlnDestinationAddress",
        {
          dlnDestinationAddress: testAddress,
          chainIdTo: BSC_CHAIN_ID,
        }
      );
    });

    it('Admin should set DlnSourceAddress', async () => {
      const testAddress = "0x1111111111111111111111111111111111111111";
      const txDestination = await dlnDestinationETH.setDlnSourceAddress(BSC_CHAIN_ID, testAddress, EVM_TYPE);
      //check events

      await expectEvent.inTransaction(
        txDestination.hash,
        artifacts.require('DlnDestination'),
        "SetDlnSourceAddress",
        {
          dlnSourceAddress: testAddress,
          chainIdFrom: BSC_CHAIN_ID,
        }
      );
    });

    it('Admin should withdrawFee', async () => {
      const testAddress = "0x1111111111111111111111111111111111111111";
      const collectedRewards = await dlnSourceEth.collectedFee(ZERO_ADDRESS);
      expect(collectedRewards.toBigInt() > 0).to.equal(true);
      const tx1 = await dlnSourceEth.withdrawFee([ZERO_ADDRESS], bob);
      //check events

      await expectEvent.inTransaction(
        tx1.hash,
        artifacts.require('DlnSource'),
        "WithdrawnFee",
        {
          tokenAddress: ZERO_ADDRESS,
          beneficiary: bob,
          amount: collectedRewards.toString()
        }
      );

      const collectedRewardsAfter = await dlnSourceEth.collectedFee(ZERO_ADDRESS);
      expect(collectedRewardsAfter.toString()).to.equal("0");
      // second withdraw fee must be with zero amount
      const tx2 = await dlnSourceEth.withdrawFee([ZERO_ADDRESS], bob);
      await expectEvent.inTransaction(
        tx2.hash,
        artifacts.require('DlnSource'),
        "WithdrawnFee",
        {
          tokenAddress: ZERO_ADDRESS,
          beneficiary: bob,
          amount: "0"
        }
      );
    });


    it('Admin should updateGlobalFee', async () => {
      const newGlobalFixedNativeFee = 1111;
      const newGlobalTransferFeeBps = 10;
      const tx1 = await dlnSourceEth.updateGlobalFee(newGlobalFixedNativeFee, newGlobalTransferFeeBps);
      await expectEvent.inTransaction(
        tx1.hash,
        artifacts.require('DlnSource'),
        "GlobalFixedNativeFeeUpdated",
        {
          oldGlobalFixedNativeFee: deployInitParamsETH.globalFixedNativeFee,
          newGlobalFixedNativeFee: newGlobalFixedNativeFee
        }
      );
      await expectEvent.inTransaction(
        tx1.hash,
        artifacts.require('DlnSource'),
        "GlobalTransferFeeBpsUpdated",
        {
          oldGlobalTransferFeeBps: deployInitParamsETH.globalTransferFeeBps,
          newGlobalTransferFeeBps: newGlobalTransferFeeBps
        }
      );
    });


    context("Should reject if called by not admin", () => {
      it('Should reject if not admin try set DlnDestinationAddress', async () => {
        const testAddress = "0x1111111111111111111111111111111111111111";
        await expect(dlnSourceEth.connect(bobAccount).setDlnDestinationAddress(BSC_CHAIN_ID, testAddress, EVM_TYPE))
          .to.be.revertedWithCustomError(dlnSourceEth, "AdminBadRole");
      });
      it('Should reject if not admin try set DlnSourceAddress', async () => {
        const testAddress = "0x1111111111111111111111111111111111111111";
        await expect(dlnDestinationETH.connect(bobAccount).setDlnSourceAddress(BSC_CHAIN_ID, testAddress, EVM_TYPE))
          .to.be.revertedWithCustomError(dlnDestinationETH, "AdminBadRole");
      });
      it('Should reject if not admin try withdrawFee', async () => {
        await expect(dlnSourceEth.connect(bobAccount).withdrawFee([ZERO_ADDRESS], bob))
          .to.be.revertedWithCustomError(dlnSourceEth, "AdminBadRole");
      });
      it('Should reject if not admin try updateGlobalFee', async () => {
        await expect(dlnSourceEth.connect(bobAccount).updateGlobalFee(101, 1))
          .to.be.revertedWithCustomError(dlnSourceEth, "AdminBadRole");
      });
    });
  });

  context("CallProxy methods", () => {
    context("Should reject if called by not callProxy", () => {
      it('Should reject if not callProxy try call claimUnlock', async () => {
        await expect(dlnSourceEth.connect(bobAccount).claimUnlock("0x1f2b3a6879e3c4169089bd3e796bbd4cf407f5c6f9bdbc9ce9e086edcade7305", bob))
          .to.be.revertedWithCustomError(dlnSourceEth, "CallProxyBadRole");
      });
      it('Should reject if not callProxy try call claimBatchUnlock', async () => {
        await expect(dlnSourceEth.connect(bobAccount).claimBatchUnlock(["0x1f2b3a6879e3c4169089bd3e796bbd4cf407f5c6f9bdbc9ce9e086edcade7305"], bob))
          .to.be.revertedWithCustomError(dlnSourceEth, "CallProxyBadRole");
      });
      it('Should reject if not callProxy try call claimCancel', async () => {
        await expect(dlnSourceEth.connect(bobAccount).claimCancel("0x1f2b3a6879e3c4169089bd3e796bbd4cf407f5c6f9bdbc9ce9e086edcade7305", bob))
          .to.be.revertedWithCustomError(dlnSourceEth, "CallProxyBadRole");
      });
      it('Should reject if not callProxy try call claimBatchCancel', async () => {
        await expect(dlnSourceEth.connect(bobAccount).claimBatchCancel(["0x1f2b3a6879e3c4169089bd3e796bbd4cf407f5c6f9bdbc9ce9e086edcade7305"], bob))
          .to.be.revertedWithCustomError(dlnSourceEth, "CallProxyBadRole");
      });
    });
  });
});