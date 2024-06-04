import { testAllowedTakerDst } from "./DlnDestination/fulfillOrder.test"
import { testSendBatchSolanaUnlock } from "./DlnDestination/sendBatchSolanaUnlock.test"
import { testFulfillOrder } from "./DlnSource/fulfillOrder"

describe("DlnDestination", function () {
    describe('Check if allowedTakerDst is respected', testAllowedTakerDst())
    describe('Check batch of claim_unlock to Solana', testSendBatchSolanaUnlock())
    describe('Check fulfill ERC20 order', testFulfillOrder(false, false));
    describe('Check fulfill ETH order', testFulfillOrder(true, false));
    describe('Check fulfill ERC20 order with ext call', testFulfillOrder(false, true));
    describe('Check fulfill ETH order with ext call', testFulfillOrder(true, true));
})