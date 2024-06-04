
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../DLN/DlnDestination.sol";

contract MockDlnDestination is DlnDestination {
    
    function initializeMock(
        IDeBridgeGate _deBridgeGate,
        uint32 _subscriptionId
    ) public initializer {
        super.initialize(_deBridgeGate, _subscriptionId);
    }


    function encodeSolanaInitWalletIfNeeded(
        bytes32 _actionBeneficiary,
        bytes32 _orderGiveTokenAddress,
        uint64 _reward1
    ) external pure returns (bytes memory) {
       return EncodeSolanaDlnMessage.encodeInitWalletIfNeededInstruction(
                    _actionBeneficiary,
                    _orderGiveTokenAddress,
                    _reward1
            );
    }


    function encodeSolanaClaimUnlockInstruction(
        uint256 _takeChainId,
        bytes32 _srcProgramId,
        bytes32 _actionBeneficiary,
        bytes32 _orderGiveTokenAddress,
        bytes32 _orderId,
        uint64 _reward2
    ) external pure returns (bytes memory) {
       return EncodeSolanaDlnMessage.encodeClaimUnlockInstruction(
                    _takeChainId,
                    _srcProgramId,
                    _actionBeneficiary,
                    _orderGiveTokenAddress,
                    _orderId,
                    _reward2
            );
    }


    function encodeSolanaClaim(
        uint256 _takeChainId,
        bytes32 _srcProgramId,
        bytes32 _actionBeneficiary,
        bytes32 _orderGiveTokenAddress,
        bytes32 _orderId,
        uint64 _reward1,
        uint64 _reward2
    ) external pure returns (bytes memory encodedClaimData) {
        // encode function that will be called in target chain
       return abi.encodePacked(
            EncodeSolanaDlnMessage.encodeInitWalletIfNeededInstruction(
                    _actionBeneficiary,
                    _orderGiveTokenAddress,
                    _reward1
            ),
            EncodeSolanaDlnMessage.encodeClaimUnlockInstruction(
                    _takeChainId,
                    _srcProgramId,
                    _actionBeneficiary,
                    _orderGiveTokenAddress,
                    _orderId,
                    _reward2
            )
       );
    }

    function encodeSolanaCancel(
        uint256 _takeChainId,
        bytes32 _srcProgramId,
        bytes32 _actionBeneficiary,
        bytes32 _orderGiveTokenAddress,
        bytes32 _orderId,
        uint64 _reward1,
        uint64 _reward2
    ) external pure returns (bytes memory encodedClaimData) {
        // encode function that will be called in target chain
        return abi.encodePacked(
            EncodeSolanaDlnMessage.encodeInitWalletIfNeededInstruction(
                _actionBeneficiary,
                _orderGiveTokenAddress,
                _reward1
            ),
            EncodeSolanaDlnMessage.encodeClaimCancelInstruction(
                _takeChainId,
                _srcProgramId,
                _actionBeneficiary,
                _orderGiveTokenAddress,
                _orderId,
                _reward2
            )
        );
    }

    /// @dev Validate that the amount will suffice to cover all execution rewards.
    /// @param _executionFee execution fee for claim
    /// @param _reward1 Fee for executing external call 1
    /// @param _reward2 Fee for executing external call 2
    function validateSolanaRewards (
        uint256 _amount,
        uint256 _executionFee,
        uint64 _reward1,
        uint64 _reward2
    ) public view {
        _validateSolanaRewards(_amount, _executionFee, _reward1, _reward2);
    }
}

