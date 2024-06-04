import { testCreateOrder, testCreateSaltedOrder } from "./DlnSource/createOrder"
import { testClaimBatchUnlock } from "./DlnSource/claimBatchUnlock.test"
import { testClaimUnlock } from "./DlnSource/claimUnlock.test"
import { testBatchUnlock } from "./DlnSource/batchUnlocksFixtures";

describe("DlnSource", function () {
    describe('Check createOrder', testCreateOrder())
    describe('Check createSaltedOrder', testCreateSaltedOrder())
    describe('Check createSaltedOrder (with referralCode)', testCreateSaltedOrder(1234))
    describe('Check createSaltedOrder (with affiliate fee)', testCreateSaltedOrder(0, true))
    describe('Check createSaltedOrder (with referral code & affiliate fee)', testCreateSaltedOrder(4321, true))
    describe('Check claimUnlock', testClaimUnlock())
    describe('Check claimBatchUnlock', testClaimBatchUnlock())
    describe("DlnSource: shift 0. batch unlock transfers (batched: native ether| tokenA| tokenB)", testBatchUnlock(0));
    describe("DlnSource: shift 1. batch unlock transfers (batched: native ether| tokenA| tokenB)", testBatchUnlock(1));
    describe("DlnSource: shift 2. batch unlock transfers (batched: native ether| tokenA| tokenB)", testBatchUnlock(2));
    describe("DlnSource: shift 4. batch unlock transfers (batched: native ether| tokenA| tokenB)", testBatchUnlock(4));
})