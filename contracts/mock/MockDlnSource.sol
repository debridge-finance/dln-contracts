// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../DLN/DlnSource.sol";
import "../libraries/DlnOrderLib.sol";

contract MockDlnSource is DlnSource {

    function initializeMock(
        IDeBridgeGate _deBridgeGate,
        uint80 _globalFixedNativeFee,
        uint16 _globalTransferFeeBps,
        uint32 _subscriptionId
    ) public initializer {
        super.initialize(_deBridgeGate, _globalFixedNativeFee, _globalTransferFeeBps, _subscriptionId);
    }

    function encodeOrder(DlnOrderLib.Order memory _order)
        public
        pure
        returns (bytes memory encoded)
    {
        return DlnOrderLib.encodeOrder(_order, false);
    }
}
