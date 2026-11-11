import { keccak256, parseTransaction, recoverTransactionAddress } from 'viem';
import { prepareFundingDemoDeposit } from './demo-plan.mjs';
import { requireFunding as check } from './schema.mjs';

// Trusted local capabilities only. No HTTP route, default signer, key loading or automatic retry.
// Use a SEPARATE private createFundingStore directory from the production funding service.
export function createFundingDemoOperator({ store, preparation, simulate, sign, broadcast, clock = () => Math.floor(Date.now() / 1000) }) {
  check(store?.transaction && store?.read && typeof preparation === 'function'
    && typeof simulate === 'function' && typeof sign === 'function' && typeof broadcast === 'function', 'DEMO_CAPABILITY_MISSING');
  function update(id, mutate) {
    return store.transaction(data => { const r = data.records[id]; check(r?.kind === 'funding-demo-attempt', 'DEMO_RECORD_MISSING'); mutate(r); return r; });
  }
  return {
    async preview() { return prepareFundingDemoDeposit({ ...await preparation(), clock }); },
    async execute({ approvedPlanHash }) {
      // Re-read source state and re-verify quote; approval binds the complete exact plan.
      const plan = await prepareFundingDemoDeposit({ ...await preparation(), clock });
      check(approvedPlanHash === plan.planHash, 'DEMO_APPROVAL_CHANGED');
      const id = `${plan.request.destination.chainId}:${plan.request.safe}`;
      store.transaction(data => {
        check(!Object.hasOwn(data.records, id), 'DEMO_ATTEMPT_EXISTS');
        data.records[id] = { kind: 'funding-demo-attempt', state: 'reserved', planHash: plan.planHash,
          fundingId: plan.fundingId, reservedAt: clock(), transactionHash: null, rawTransaction: null };
        return data.records[id];
      });
      try {
        check(clock() < plan.expiresAt, 'DEMO_PLAN_EXPIRED');
        check(await simulate(structuredClone(plan.transaction)) === true, 'DEMO_SIMULATION_FAILED');
        check(clock() < plan.expiresAt, 'DEMO_PLAN_EXPIRED');
        const raw = await sign(structuredClone(plan.transaction));
        const parsed = parseTransaction(raw);
        const tx = plan.transaction;
        check(parsed.type === 'legacy' && parsed.chainId === tx.chainId && parsed.to?.toLowerCase() === tx.to.toLowerCase()
          && parsed.data === tx.data && (parsed.value ?? 0n) === BigInt(tx.value)
          && parsed.nonce === tx.nonce && parsed.gas === BigInt(tx.gas) && parsed.gasPrice === BigInt(tx.gasPrice)
          && (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() === tx.from.toLowerCase(), 'DEMO_SIGNED_TRANSACTION_CHANGED');
        const hash = keccak256(raw);
        // Full signed bytes and known hash are durable BEFORE invoking the network.
        update(id, r => { r.state = 'prepared'; r.transactionHash = hash; r.rawTransaction = raw; });
        check(clock() < plan.expiresAt, 'DEMO_PLAN_EXPIRED');
        const reported = await broadcast(raw);
        check(typeof reported === 'string' && reported.toLowerCase() === hash, 'DEMO_BROADCAST_HASH_CHANGED');
        update(id, r => { r.state = 'submitted'; });
        return { fundingId: plan.fundingId, transactionHash: hash, state: 'submitted', deliveryProven: false, productionRoundReady: false };
      } catch (error) {
        update(id, r => { r.state = 'needs_review'; });
        throw error;
      }
    },
  };
}
