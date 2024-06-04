// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

library DlnOrderLib {
    /* ========== CONSTANTS ========== */

    uint256 public constant MAX_ADDRESS_LENGTH = 255;
    uint256 public constant EVM_ADDRESS_LENGTH = 20;
    uint256 public constant SOLANA_ADDRESS_LENGTH = 32;

    /* ========== ERRORS ========== */

    error WrongExternalCallHash();
    error WrongAddressLength();

    /* ========== ENUMS ========== */

    /**
     * @dev Enum defining the supported blockchain engines.
     * - `UNDEFINED`: Represents an undefined or unknown blockchain engine (0).
     * - `EVM`: Represents the Ethereum Virtual Machine (EVM) blockchain engine (1).
     * - `SOLANA`: Represents the Solana blockchain engine (2).
     */
    enum ChainEngine {
        UNDEFINED, // 0
        EVM, // 1
        SOLANA // 2
    }

    /* ========== STRUCTS ========== */

    /// @dev Struct representing the creation parameters for creating an order on the (EVM) chain.
    struct OrderCreation {
        /// Address of the ERC-20 token that the maker is offering as part of this order.
        /// Use the zero address to indicate that the maker is offering a native blockchain token (such as Ether, Matic, etc.).
        address giveTokenAddress;
        /// Amount of tokens the maker is offering.
        uint256 giveAmount;
        /// Address of the ERC-20 token that the maker is willing to accept on the destination chain.
        bytes takeTokenAddress;
        /// Amount of tokens the maker is willing to accept on the destination chain.
        uint256 takeAmount;
        // the ID of the chain where an order should be fulfilled.
        uint256 takeChainId;
        /// Address on the destination chain where funds should be sent upon order fulfillment.
        bytes receiverDst;
        /// Address on the source (current) chain authorized to patch the order by adding more input tokens, making it more attractive to takers.
        address givePatchAuthoritySrc;
        /// Address on the destination chain authorized to patch the order by reducing the take amount, making it more attractive to takers,
        /// and can also cancel the order in the take chain.
        bytes orderAuthorityAddressDst;
        // An optional address restricting anyone in the open market from fulfilling
        // this order but the given address. This can be useful if you are creating a order
        // for a specific taker. By default, set to empty bytes array (0x)
        bytes allowedTakerDst;
        /// An optional external call data payload.
        bytes externalCall;
        // An optional address on the source (current) chain where the given input tokens
        // would be transferred to in case order cancellation is initiated by the orderAuthorityAddressDst
        // on the destination chain. This property can be safely set to an empty bytes array (0x):
        // in this case, tokens would be transferred to the arbitrary address specified
        // by the orderAuthorityAddressDst upon order cancellation
        bytes allowedCancelBeneficiarySrc;
    }

    /// @dev  Struct representing an order.
    struct Order {
        /// Nonce for each maker.
        uint64 makerOrderNonce;
        /// Order maker address (EOA signer for EVM) in the source chain.
        bytes makerSrc;
        /// Chain ID where the order's was created.
        uint256 giveChainId;
        /// Address of the ERC-20 token that the maker is offering as part of this order.
        /// Use the zero address to indicate that the maker is offering a native blockchain token (such as Ether, Matic, etc.).
        bytes giveTokenAddress;
        /// Amount of tokens the maker is offering.
        uint256 giveAmount;
        // the ID of the chain where an order should be fulfilled.
        uint256 takeChainId;
        /// Address of the ERC-20 token that the maker is willing to accept on the destination chain.
        bytes takeTokenAddress;
        /// Amount of tokens the maker is willing to accept on the destination chain.
        uint256 takeAmount;
        /// Address on the destination chain where funds should be sent upon order fulfillment.
        bytes receiverDst;
        /// Address on the source (current) chain authorized to patch the order by adding more input tokens, making it more attractive to takers.
        bytes givePatchAuthoritySrc;
        /// Address on the destination chain authorized to patch the order by reducing the take amount, making it more attractive to takers,
        /// and can also cancel the order in the take chain.
        bytes orderAuthorityAddressDst;
        // An optional address restricting anyone in the open market from fulfilling
        // this order but the given address. This can be useful if you are creating a order
        // for a specific taker. By default, set to empty bytes array (0x)
        bytes allowedTakerDst;
        // An optional address on the source (current) chain where the given input tokens
        // would be transferred to in case order cancellation is initiated by the orderAuthorityAddressDst
        // on the destination chain. This property can be safely set to an empty bytes array (0x):
        // in this case, tokens would be transferred to the arbitrary address specified
        // by the orderAuthorityAddressDst upon order cancellation
        bytes allowedCancelBeneficiarySrc;
        /// An optional external call data payload.
        bytes externalCall;
    }

    /* ========== Methods ========== */

    function getOrderId(Order memory _order) internal pure returns (bytes32) {
        return keccak256(encodeOrder(_order, false));
    }

    function getOrderIdWithExternalCallHash(
        Order memory _order
    ) internal pure returns (bytes32) {
        return keccak256(encodeOrder(_order, true));
    }

    function encodeOrder(
        Order memory _order,
        bool externalCallIsHash
    ) internal pure returns (bytes memory encoded) {
        {
            if (
                _order.makerSrc.length > MAX_ADDRESS_LENGTH ||
                _order.giveTokenAddress.length > MAX_ADDRESS_LENGTH ||
                _order.takeTokenAddress.length > MAX_ADDRESS_LENGTH ||
                _order.receiverDst.length > MAX_ADDRESS_LENGTH ||
                _order.givePatchAuthoritySrc.length > MAX_ADDRESS_LENGTH ||
                _order.allowedTakerDst.length > MAX_ADDRESS_LENGTH ||
                _order.allowedCancelBeneficiarySrc.length > MAX_ADDRESS_LENGTH
            ) revert WrongAddressLength();
        }
        // | Bytes | Bits | Field                                                |
        // | ----- | ---- | ---------------------------------------------------- |
        // | 8     | 64   | Nonce
        // | 1     | 8    | Maker Src Address Size (!=0)                         |
        // | N     | 8*N  | Maker Src Address                                              |
        // | 32    | 256  | Give Chain Id                                        |
        // | 1     | 8    | Give Token Address Size (!=0)                        |
        // | N     | 8*N  | Give Token Address                                   |
        // | 32    | 256  | Give Amount                                          |
        // | 32    | 256  | Take Chain Id                                        |
        // | 1     | 8    | Take Token Address Size (!=0)                        |
        // | N     | 8*N  | Take Token Address                                   |
        // | 32    | 256  | Take Amount                                          |                         |
        // | 1     | 8    | Receiver Dst Address Size (!=0)                      |
        // | N     | 8*N  | Receiver Dst Address                                 |
        // | 1     | 8    | Give Patch Authority Address Size (!=0)              |
        // | N     | 8*N  | Give Patch Authority Address                         |
        // | 1     | 8    | Order Authority Address Dst Size (!=0)               |
        // | N     | 8*N  | Order Authority Address Dst                     |
        // | 1     | 8    | Allowed Taker Dst Address Size                       |
        // | N     | 8*N  | * Allowed Taker Address Dst                          |
        // | 1     | 8    | Allowed Cancel Beneficiary Src Address Size          |
        // | N     | 8*N  | * Allowed Cancel Beneficiary Address Src             |
        // | 1     | 8    | Is External Call Presented 0x0 - Not, != 0x0 - Yes   |
        // | 32    | 256  | * External Call Envelope Hash

        encoded = abi.encodePacked(
            _order.makerOrderNonce,
            (uint8)(_order.makerSrc.length),
            _order.makerSrc
        );
        {
            encoded = abi.encodePacked(
                encoded,
                _order.giveChainId,
                (uint8)(_order.giveTokenAddress.length),
                _order.giveTokenAddress,
                _order.giveAmount,
                _order.takeChainId
            );
        }
        //Avoid stack to deep
        {
            encoded = abi.encodePacked(
                encoded,
                (uint8)(_order.takeTokenAddress.length),
                _order.takeTokenAddress,
                _order.takeAmount,
                (uint8)(_order.receiverDst.length),
                _order.receiverDst
            );
        }
        {
            encoded = abi.encodePacked(
                encoded,
                (uint8)(_order.givePatchAuthoritySrc.length),
                _order.givePatchAuthoritySrc,
                (uint8)(_order.orderAuthorityAddressDst.length),
                _order.orderAuthorityAddressDst
            );
        }
        {
            encoded = abi.encodePacked(
                encoded,
                (uint8)(_order.allowedTakerDst.length),
                _order.allowedTakerDst,
                (uint8)(_order.allowedCancelBeneficiarySrc.length),
                _order.allowedCancelBeneficiarySrc,
                _order.externalCall.length > 0
            );
        }
        if (_order.externalCall.length > 0) {
            if (externalCallIsHash) {
                if (_order.externalCall.length != 32) revert WrongExternalCallHash();
                encoded = abi.encodePacked(encoded, _order.externalCall);
            } else {
                encoded = abi.encodePacked(
                    encoded,
                    keccak256(_order.externalCall)
                );
            }
        }
        return encoded;
    }
}
