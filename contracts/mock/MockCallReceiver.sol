// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockCallReceiver {
    using SafeERC20 for IERC20;
    function collectTokens(address tokenAddress, uint256 amount) external {
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
    }
}
