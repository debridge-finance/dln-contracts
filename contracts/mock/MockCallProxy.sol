// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

contract MockCallProxy {
    bytes public submissionNativeSender;
    uint256 public submissionChainIdFrom;

    function bypassCall(bytes calldata _submissionNativeSender, uint _submissionChainIdFrom, address to, bytes calldata data) external payable {
        submissionNativeSender = _submissionNativeSender;
        submissionChainIdFrom = _submissionChainIdFrom;

        (bool success, bytes memory result) = to.call(data);

        if(!success) {
            // Revert the transaction with the revert reason from the called contract
            if (result.length > 0) {
                // The easiest way to bubble up the revert reason is to use solidity's built-in functionality
                assembly {
                    let result_size := mload(result)
                    revert(add(32, result), result_size)
                }
            } else {
                revert("Call to the target contract failed without a revert reason");
            }
        }
    }
}