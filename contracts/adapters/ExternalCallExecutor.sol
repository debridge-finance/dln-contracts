// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "./ExternalCallExecutorBase.sol";
import "../interfaces/IExternalCallExecutor.sol";
import "../libraries/DlnExternalCallLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ExternalCallExecutor is
    ExternalCallExecutorBase,
    IExternalCallExecutor
{   
    using SafeERC20 for IERC20;

    // Declare prohibitedSelectors as a constant
    bytes4 private constant APPROVE_SELECTOR = 0x095ea7b3;
    bytes4 private constant TRANSFER_FROM_SELECTOR = 0x23b872dd;
    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 private constant INCREASE_ALLOWANCE_SELECTOR = 0x39509351;

    /* ========== ERRORS ========== */

    error CallFailed();

    /* ========== CONSTRUCTOR  ========== */

    constructor() {}

    /* ========== PUBLIC METHODS ========== */

    /**
     * @inheritdoc IExternalCallExecutor
     */
    function onEtherReceived(
        bytes32 /*_orderId*/,
        address _fallbackAddress,
        bytes memory _payload
    ) external payable onlyAdapter returns (bool callSucceeded, bytes memory callResult) {
        DlnExternalCallLib.ExternalCallPayload memory executionData = abi
            .decode(_payload, (DlnExternalCallLib.ExternalCallPayload));
        uint256 preBalance = address(this).balance - msg.value;

        // if prohibited function selector, transfer all msg.value to reserve address
        if (
            isProhibitedSelector(executionData.callData) ||
            executionData.to == address(0)
        ) {
            _safeTransferETH(_fallbackAddress, msg.value);
            return (false, "Prohibited selector");
        }

        (callSucceeded, callResult) = _execute(
            executionData.to,
            msg.value,
            executionData.callData,
            executionData.txGas
        );

        uint256 amountLeft = address(this).balance - preBalance;
        if (amountLeft != 0) {
            _safeTransferETH(_fallbackAddress, amountLeft);
        }
    }

    /**
     * @inheritdoc IExternalCallExecutor
     */
    function onERC20Received(
        bytes32 /*_orderId*/,
        address _token,
        uint256 _transferredAmount,
        address _fallbackAddress,
        bytes memory _payload
    ) external onlyAdapter returns (bool callSucceeded, bytes memory callResult) {
        IERC20 token = IERC20(_token);
        uint256 preBalance = token.balanceOf(address(this)) - _transferredAmount;
        DlnExternalCallLib.ExternalCallPayload memory executionData = abi
            .decode(_payload, (DlnExternalCallLib.ExternalCallPayload));

        // if prohibited function selector, transfer all amount to reserve address
        if (
            isProhibitedSelector(executionData.callData) ||
            executionData.to == address(0)
        ) {
            token.safeTransfer(_fallbackAddress, _transferredAmount);
            return (false, "Prohibited selector");
        }
        // create approve to allow the target contract to spend tokens.
        if (_transferredAmount != 0) {
            _customApprove(_token, executionData.to, _transferredAmount);
        }

        (callSucceeded, callResult) = _execute(
            executionData.to,
            0,
            executionData.callData,
            executionData.txGas
        );

        uint256 amountLeft = token.balanceOf(address(this)) - preBalance;

        if (amountLeft != 0) {
            token.safeTransfer(_fallbackAddress, amountLeft);
            _customApprove(_token, executionData.to, 0);
        }
    }

    /* ========== INTERNAL METHODS ========== */

    /**
     * @notice Checks if the function selector is prohibited to be called.
     * @dev This function extracts the function selector from the `_data` and compares it
     *      against a list of prohibited function selectors.
     * @param _data The encoded data containing the function selector and arguments.
     * @return A boolean indicating whether the function selector specified in the `_data` is prohibited.
     */
    function isProhibitedSelector(bytes memory _data) public pure returns (bool) {
        bytes4 functionSelector = _toBytes4(_data, 0);

        // Check against the constant selectors
        return functionSelector == APPROVE_SELECTOR ||
                 functionSelector == TRANSFER_FROM_SELECTOR ||
                 functionSelector == TRANSFER_SELECTOR ||
                 functionSelector == INCREASE_ALLOWANCE_SELECTOR;
    }

    /**
     * @notice Converts the first 4 bytes starting at a specific position in a byte array to a bytes4 type.
     * @dev This function uses assembly for efficient memory operations.
     * @param _bytes The byte array to be converted.
     * @param _start The position in the byte array to start the conversion.
     * @return The first 4 bytes starting at the `_start` position in the byte array as a bytes4 type.
     * throws If there are less than 4 bytes starting at the `_start` position in the byte array.
     */
    function _toBytes4(
        bytes memory _bytes,
        uint256 _start
    ) internal pure returns (bytes4) {
        require(_bytes.length >= _start + 4, "toBytes4_outOfBounds");
        bytes4 tempUint;

        assembly {
            tempUint := mload(add(add(_bytes, 0x20), _start))
        }

        return tempUint;
    }
}
