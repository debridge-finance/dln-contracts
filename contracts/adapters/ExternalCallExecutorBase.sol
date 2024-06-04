// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract ExternalCallExecutorBase is AccessControl {
    using Address for address;
    using SafeERC20 for IERC20;

    /* ========== ERRORS ========== */

    error AdminBadRole();
    error AdapterBadRole();
    error EthTransferFailed();
    error NotEnoughTxGas();

    /* ========== STATE VARIABLES ========== */

    bytes32 public constant ADAPTER_ROLE = keccak256("ADAPTER_ROLE");

    /* ========== MODIFIERS ========== */

    modifier onlyAdmin() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert AdminBadRole();
        _;
    }

    modifier onlyAdapter() {
        if (!hasRole(ADAPTER_ROLE, msg.sender)) revert AdapterBadRole();
        _;
    }

    /* ========== CONSTRUCTOR  ========== */

    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /* ========== ADMIN METHODS ========== */

    /**
     * @notice Allows the admin to withdraw tokens or ETH from the contract.
     * @dev Only callable by the admin.
     * @param _token The address of the ERC20 token to be withdrawn.
     *               Use the zero address for withdrawing ETH.
     * @param _recipient The address to receive the tokens or ETH.
     * @param _amount The amount of tokens or ETH to be withdrawn.
     */
    function rescueFunds(
        address _token,
        address _recipient,
        uint256 _amount
    ) external onlyAdmin {
        if (_token == address(0)) {
            _safeTransferETH(_recipient, _amount);
        } else {
            IERC20(_token).safeTransfer(_recipient, _amount);
        }
    }

    /* ========== INTERNAL METHODS ========== */

    /**
    * @notice Makes an external call to the provided address with the specified ether, data payload, and optional custom gas.
    * @param _to The address to call.
    * @param _value The amount of ether to send.
    * @param _data The data payload for the call.
    * @param _txGas The custom gas amount for the call. If set to 0, it uses the default.
    * @return callSucceeded A boolean indicating whether the call was successful.
    * @return callResult The data returned from the call.
    * 
    * Notes:
    * 1. If the target address is not a contract, the function does not make a call.
    * 2. If `_txGas` is specified and there's not enough gas left in the current transaction, the function will revert.
    * 3. The function takes into account the EIP-150's 1/64th gas rule.
    */
    function _execute(
        address _to,
        uint256 _value,
        bytes memory _data,
        uint256 _txGas
    ) internal returns (bool callSucceeded, bytes memory callResult) {
        if (_to.isContract()) {
            if (_txGas > 0) {
                // We include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
                if (gasleft() < _txGas * 64 / 63) revert NotEnoughTxGas();
                (callSucceeded, callResult) = _to.call{value: _value, gas: _txGas}(_data);
            } else {
                (callSucceeded, callResult) = _to.call{value: _value}(_data);
            }
        }
    }

    /**
     * @notice Internal function to approve the transfer of tokens on behalf of the contract.
     * @dev This function uses low-level call to interact with ERC20 contracts that don't strictly follow the standard.
     * @param token The address of the ERC20 token to be approved.
     * @param spender The address which will be approved to spend the tokens.
     * @param value The amount of tokens to be approved for spending.
     */
    function _customApprove(
        address token,
        address spender,
        uint256 value
    ) internal {
        bytes memory returndata = token.functionCall(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value),
            "ERC20 approve failed"
        );
        if (returndata.length > 0) {
            // Return data is optional
            require(
                abi.decode(returndata, (bool)),
                "ERC20 operation did not succeed"
            );
        }
    }

    /*
     * @dev transfer ETH to an address, revert if it fails.
     * @param to recipient of the transfer
     * @param value the amount to send
     */
    function _safeTransferETH(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        if (!success) revert EthTransferFailed();
    }
}
