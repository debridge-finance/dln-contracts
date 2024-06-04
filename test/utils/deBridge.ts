import hre from "hardhat";
import { DeBridgeGate } from "../../typechain-types";
import { ContractTransaction, Overrides } from "@ethersproject/contracts"
import { evm } from "@debridge-finance/desdk"

/**
 * Claims submission from a given transaction, and returns this claim tx.
 * Note: this is useful when we need to inspect claim tx (e.g., events emitted within it).
 * This helper is necessary because deBridge.emulator.autoClaim() returns submissionIds instead of txnHashes
 */
export async function claimSubmission(gate: DeBridgeGate, submissionTx: string | ContractTransaction | Promise<ContractTransaction>, overrides?: Overrides): Promise<ContractTransaction> {
    const submissionTxHash = typeof submissionTx == 'string'
        ? submissionTx
        : (await (await submissionTx).wait()).transactionHash;

    const evmContext = {
        // pass the current hardhat network. deSDK is ready to accept it
        provider: hre,

        // pass the custom address of the gate we are interacting with
        deBridgeGateAddress: gate.address,

        // emulated gate works without signatures, so pass a dummy
        signatureStorage: new evm.DummySignatureStorage()
    };

    const submissions = await evm.Submission.findAll(
        submissionTxHash,
        evmContext
    );
    if (submissions.length != 1) {
        throw new Error("Unexpected: support only one submission per tx")
    }
    const [submission] = submissions;

    const claim = await submission.toEVMClaim(evmContext);
    const args = await claim.getEncodedArgs();
    return gate.claim(...args, overrides || {});
}