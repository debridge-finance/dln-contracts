// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@debridge-finance/debridge-contracts-v1/contracts/interfaces/IDeBridgeGate.sol";
import "@debridge-finance/debridge-contracts-v1/contracts/libraries/SignatureUtil.sol";
import "../interfaces/IERC20Permit.sol";
import "../libraries/BytesLib.sol";
import "../libraries/DlnOrderLib.sol";

abstract contract DlnBase is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using AddressUpgradeable for address payable;
    using SignatureUtil for bytes;

    /* ========== CONSTANTS ========== */

    /// @dev Basis points or bps, set to 10 000 (equal to 1/10000). Used to express relative values (fees)
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @dev Role allowed to stop transfers
    bytes32 public constant GOVMONITORING_ROLE =
        keccak256("GOVMONITORING_ROLE");

    uint256 public constant MAX_ADDRESS_LENGTH = 255;
    uint256 public constant EVM_ADDRESS_LENGTH = 20;
    uint256 public constant SOLANA_ADDRESS_LENGTH = 32;

    /* ========== STATE VARIABLES ========== */

    // @dev Maps chainId => type of chain engine
    mapping(uint256 => DlnOrderLib.ChainEngine) public chainEngines;

    IDeBridgeGate public deBridgeGate;

    /* ========== ERRORS ========== */

    error AdminBadRole();
    error CallProxyBadRole();
    error GovMonitoringBadRole();
    error NativeSenderBadRole(bytes nativeSender, uint256 chainIdFrom);
    error MismatchedTransferAmount();
    error MismatchedOrderId();
    error ZeroAddress();
    error NotSupportedDstChain();
    error EthTransferFailed();
    error Unauthorized();
    error IncorrectOrderStatus();
    error WrongChain();
    error WrongArgument();
    error UnknownEngine();

    /* ========== EVENTS ========== */

    /* ========== MODIFIERS ========== */

    modifier onlyAdmin() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert AdminBadRole();
        _;
    }

    modifier onlyGovMonitoring() {
        if (!hasRole(GOVMONITORING_ROLE, msg.sender))
            revert GovMonitoringBadRole();
        _;
    }

    /* ========== CONSTRUCTOR  ========== */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __DlnBase_init(IDeBridgeGate _deBridgeGate) internal initializer {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __Pausable_init_unchained();
        __DlnBase_init_unchained(_deBridgeGate);
    }

    function __DlnBase_init_unchained(IDeBridgeGate _deBridgeGate)
        internal
        initializer
    {
        deBridgeGate = _deBridgeGate;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /* ========== ADMIN METHODS ========== */

    /// @dev Stop all protocol.
    function pause() external onlyGovMonitoring {
        _pause();
    }

    /// @dev Unlock protocol.
    function unpause() external onlyAdmin {
        _unpause();
    }

    /* ========== INTERNAL ========== */

    /// @dev Safe transfer tokens and check that receiver will receive exact amount (check only if to != from)
    function _safeTransferFrom(
        address _tokenAddress,
        address _from,
        address _to,
        uint256 _amount
    ) internal {
        IERC20Upgradeable token = IERC20Upgradeable(_tokenAddress);
        uint256 balanceBefore = token.balanceOf(_to);
        token.safeTransferFrom(_from, _to, _amount);
        // Received real amount
        uint256 receivedAmount = token.balanceOf(_to) - balanceBefore;
        if (_from != _to && _amount != receivedAmount) revert MismatchedTransferAmount();
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

    /// @dev Transfer ETH or token
    /// @param tokenAddress address(0) to transfer ETH
    /// @param to  recipient of the transfer
    /// @param value the amount to send
    function _safeTransferEthOrToken(
        address tokenAddress,
        address to,
        uint256 value
    ) internal {
        if (value > 0) {
            if (tokenAddress == address(0)) {
                _safeTransferETH(to, value);
            } else {
                IERC20Upgradeable(tokenAddress).safeTransfer(to, value);
            }
        }
    }

    // ============ VIEWS ============

    function getOrderId(DlnOrderLib.Order memory _order) public pure returns (bytes32) {
        return DlnOrderLib.getOrderId(_order);
    }
}
