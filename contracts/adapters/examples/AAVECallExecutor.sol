// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../ExternalCallExecutorBase.sol";
import "../../interfaces/IExternalCallExecutor.sol";
import "../../libraries/DlnExternalCallLib.sol";
import "../../libraries/BytesLib.sol";

contract AAVECallExecutor is ExternalCallExecutorBase, IExternalCallExecutor {
    using BytesLib for bytes;
    /* ========== ERRORS ========== */

    error NotSupported();

    /* ========== CONSTRUCTOR  ========== */

    constructor(address _externalCallAdapter) {
        _setupRole(ADAPTER_ROLE, _externalCallAdapter);
    }

    /* ========== PUBLIC METHODS ========== */

    /**
     * @inheritdoc IExternalCallExecutor
     */
    function onEtherReceived(
        bytes32 _orderId,
        address _fallbackAddress,
        bytes memory _payload
    ) external payable onlyAdapter returns (bool callSucceeded, bytes memory callResult) {
        revert NotSupported();
    }

    /**
     * @inheritdoc IExternalCallExecutor
     */
    function onERC20Received(
        bytes32 _orderId,
        address _token,
        uint256 _transferredAmount,
        address _fallbackAddress,
        bytes memory _payload
    ) external onlyAdapter returns (bool callSucceeded, bytes memory callResult) {
        // IERC20 token = IERC20(_token);
        address pool = _payload.toAddress(0);
        address onBehalfOf = _payload.toAddress(20);
        // create approve to allow the target contract to spend tokens.
        if (_transferredAmount > 0) {
            _customApprove(_token, pool, _transferredAmount);
        }

        IPool(pool).supply(_token, _transferredAmount, onBehalfOf, 0);
        callSucceeded = true;
    }
}

/**
 * @title IPool
 * @author Aave
 * @notice Defines the basic interface for an Aave Pool.
 */
interface IPool {
    /**
     * @notice Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
     * - E.g. User supplies 100 USDC and gets in return 100 aUSDC
     * @param asset The address of the underlying asset to supply
     * @param amount The amount to be supplied
     * @param onBehalfOf The address that will receive the aTokens, same as msg.sender if the user
     *   wants to receive them on his own wallet, or a different address if the beneficiary of aTokens
     *   is a different wallet
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;
}
