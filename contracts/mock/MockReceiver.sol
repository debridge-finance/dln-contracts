// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockReceiver {
    using SafeERC20 for IERC20;

    event ReceivedEth(uint256 amount, address receiver);
    event ReceivedERC20(uint256 amount, address receiver);
    event ReceivedEther(address sender, uint256 value);

    function receiveETH(address _receiver) external payable {
        _receiver.call{value: msg.value}(new bytes(0));
        emit ReceivedEth(msg.value, _receiver);
    }

    function receiveERC20(
        uint256 _amount,
        address _tokenAddress,
        address _receiver
    ) external {
        IERC20(_tokenAddress).safeTransferFrom(msg.sender, _receiver, _amount);
        emit ReceivedERC20(_amount, _receiver);
    }
     
    receive () external payable {
        emit ReceivedEther(msg.sender, msg.value);
    }
}