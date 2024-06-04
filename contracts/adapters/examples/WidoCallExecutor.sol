// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../ExternalCallExecutorBase.sol";
import "../../interfaces/IExternalCallExecutor.sol";
import "../../libraries/DlnExternalCallLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract WidoCallExecutor is ExternalCallExecutorBase, IExternalCallExecutor {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    address public widoRouter;
    address public widoTokenManager;

    /* ========== ERRORS ========== */

    error NotSupported();

    /* ========== CONSTRUCTOR  ========== */

    constructor(
        address _widoRouter,
        address _widoTokenManager,
        address _externalCallAdapter
    ) {
        widoRouter = _widoRouter;
        widoTokenManager = _widoTokenManager;
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
        IERC20 token = IERC20(_token);
        uint256 amount = token.balanceOf(address(this));

        // create approve to allow the target contract to spend tokens.
        if (amount > 0) {
            _customApprove(_token, widoTokenManager, amount);
        }

        widoRouter.call(_payload);
        callSucceeded = true;

        amount = token.balanceOf(address(this));

        if (amount > 0) {
            token.safeTransfer(_fallbackAddress, amount);
            _customApprove(_token, widoTokenManager, 0);
        }
    }
}
