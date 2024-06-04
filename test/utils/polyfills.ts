import { ChainId, tokenStringToBuffer } from "@debridge-finance/dln-client";
import { ethers } from "hardhat";

declare global {
    interface String {
        addressEq(address: string): boolean;
        toBuffer(chainId: ChainId): Uint8Array;
    }
}
String.prototype.addressEq = function(address: string): boolean {
    return ethers.utils.getAddress(this.toString()) == ethers.utils.getAddress(address)
}

String.prototype.toBuffer = function(chainId: ChainId): Uint8Array {
    return tokenStringToBuffer(chainId, this.toString());
}