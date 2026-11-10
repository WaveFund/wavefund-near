import { parseAbi, encodeFunctionData, isAddress, zeroAddress } from 'viem';
import { namedOutputs } from '../chain.mjs';

export const managerSafeAbi = parseAbi(['function VERSION() view returns(string)', 'function getOwners() view returns(address[])', 'function getThreshold() view returns(uint256)', 'function isModuleEnabled(address) view returns(bool)', 'function enableModule(address)', 'function getModulesPaginated(address,uint256) view returns(address[],address)', 'function disableModule(address,address)']);
const hookAbi = parseAbi(['function adapter() view returns(address)', 'function poolManager() view returns(address)']);
const approveAbi = parseAbi(['function approve(address,uint256) returns(bool)']);
const tokenMeta = parseAbi(['function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)']);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export function createManagerService({ publicClient, contracts, abis, chainId = 31337 }) {
  const read = (name, functionName, args = [], blockNumber) => publicClient.readContract({ address: contracts[name], abi: name === 'safe' ? managerSafeAbi : name === 'hook' ? hookAbi : ['stable', 'asset'].includes(name) ? tokenMeta : abis[name], functionName, args, blockNumber });
  async function inspect() {
    if (![31337, 1313161555].includes(chainId) || await publicClient.getChainId() !== chainId) throw new Error('Manager network mismatch');
    const block = await publicClient.getBlock(); const b = block.number;
    for (const name of ['safe', 'stable', 'asset', 'module', 'engine', 'tracker', 'oracle', 'router', 'market', 'tokens', 'registry', 'poolManager', 'hook']) {
      const code = isAddress(contracts[name] ?? '') ? await publicClient.getCode({ address: contracts[name], blockNumber: b }) : null;
      if (!isAddress(contracts[name] ?? '') || same(contracts[name], zeroAddress) || !code || code === '0x') throw new Error(`Missing manager contract: ${name}`);
    }
    const [version, owners, threshold, enabled, moduleSafe, moduleEngine, stable, asset, router, oracle, tracker, allocationSource, executionModule, performanceTracker, trackerModule, trackerEngine, trackerOracle, stableDecimals, assetDecimals, maxSlippage, activeRoundId, authorizationValues, currentRoundId, seed, safeAdmin] = await Promise.all([
      read('safe', 'VERSION', [], b), read('safe', 'getOwners', [], b), read('safe', 'getThreshold', [], b), read('safe', 'isModuleEnabled', [contracts.module], b),
      ...['safe', 'engine', 'stable', 'asset', 'router', 'oracle', 'tracker'].map((fn) => read('module', fn, [], b)),
      ...['allocationSource', 'executionModule', 'performanceTracker'].map((fn) => read('engine', fn, [], b)),
      ...['module', 'engine', 'oracle'].map((fn) => read('tracker', fn, [], b)),
      read('stable', 'decimals', [], b), read('asset', 'decimals', [], b), read('module', 'maxSlippageBps', [], b), read('module', 'activeRoundId', [], b), read('module', 'authorization', [], b), read('engine', 'currentRoundId', [], b), read('engine', 'protocolLiquiditySeed', [], b), read('engine', 'hasRole', ['0x' + '00'.repeat(32), contracts.safe], b),
    ]);
    if (version !== '1.4.1' || threshold < 1n || threshold > BigInt(owners.length)) throw new Error('Unsupported or uninitialized Safe');
    const bindings = [[moduleSafe, contracts.safe], [moduleEngine, contracts.engine], [stable, contracts.stable], [asset, contracts.asset], [router, contracts.router], [oracle, contracts.oracle], [tracker, contracts.tracker], [allocationSource, contracts.module], [executionModule, contracts.module], [performanceTracker, contracts.tracker], [trackerModule, contracts.module], [trackerEngine, contracts.engine], [trackerOracle, contracts.oracle]];
    if (!safeAdmin || bindings.some(([actual, expected]) => !same(actual, expected)) || stableDecimals !== 6 || assetDecimals !== 18) throw new Error('Unsafe manager contract bindings or token decimals');
    const linkSpecs = [['engine', 'market', 'market'], ['engine', 'tokens', 'tokens'], ['engine', 'registry', 'registry'], ['engine', 'usdc', 'stable'], ['market', 'quantumRound', 'engine'], ['market', 'proposalTokens', 'tokens'], ['market', 'poolManager', 'poolManager'], ['market', 'waveHook', 'hook'], ['market', 'owner', 'engine'], ['hook', 'adapter', 'market'], ['hook', 'poolManager', 'poolManager'], ['registry', 'usdc', 'stable']];
    const links = await Promise.all(linkSpecs.map(([name, method]) => read(name, method, [], b)));
    if (links.some((actual, i) => !same(actual, contracts[linkSpecs[i][2]]))) throw new Error('Forecast market or hook binding mismatch');
    let activeStatus = null;
    if (activeRoundId > 0n) activeStatus = Number(await read('engine', 'roundStatus', [activeRoundId], b));
    const authorization = namedOutputs(abis.module, 'authorization', authorizationValues);
    const [stableBalance, assetBalance] = await Promise.all([read('stable', 'balanceOf', [contracts.safe], b), read('asset', 'balanceOf', [contracts.safe], b)]);
    let oracleState;
    try { const prices = await read('oracle', 'read', [], b); if (prices[0] <= 0n || prices[1] <= 0n || prices[2] <= 0n || prices[2] > block.timestamp) throw new Error('Invalid prices'); oracleState = { usable: true, publishedAt: prices[2].toString() }; } catch { oracleState = { usable: false, message: 'Oracle unavailable or stale; round preparation is blocked.' }; }
    return { chainId, blockNumber: b.toString(), timestamp: block.timestamp.toString(), contracts, version, owners, threshold: Number(threshold), moduleEnabled: enabled, maxSlippageBps: Number(maxSlippage), activeRoundId: activeRoundId.toString(), activeStatus, pendingAuthorization: authorization.roundId.toString(), currentRoundId: currentRoundId.toString(), stableBalance: stableBalance.toString(), assetBalance: assetBalance.toString(), sponsorReserve: seed.toString(), oracle: oracleState, unsignedOnly: true, note: 'Bindings verified against deployed contracts; bytecode provenance and independent security review remain separate checks.' };
  }
  async function prepare(input) {
    if (!input || !['enable', 'policy', 'authorize', 'revoke', 'disable', 'seed', 'withdraw-seed'].includes(input.action)) throw new Error('Unknown manager action');
    const allowed = { seed: ['action', 'amountMicro'], 'withdraw-seed': ['action', 'amountMicro'], enable: ['action'], disable: ['action'], revoke: ['action'], policy: ['action', 'slippageBps'], authorize: ['action', 'tradingSeconds', 'evaluationSeconds', 'executionGraceSeconds', 'twapWindowSeconds'] }[input.action];
    if (Object.keys(input).sort().join(',') !== allowed.sort().join(',')) throw new Error('Unexpected manager action parameters');
    const state = await inspect(); const busy = state.activeStatus != null && ![3, 4].includes(state.activeStatus);
    const call = (to, abi, functionName, args) => ({ to, value: '0', data: encodeFunctionData({ abi, functionName, args }), contractMethod: null, contractInputsValues: null });
    const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Manager policy value outside allowed bounds'); return BigInt(value); };
    let transaction; let fundingTransactions;
    if (['seed', 'withdraw-seed'].includes(input.action)) {
      if (busy || state.pendingAuthorization !== '0') throw new Error('Active round or authorization blocks sponsor funding changes');
      if (typeof input.amountMicro !== 'string' || !/^[1-9]\d{0,17}$/.test(input.amountMicro)) throw new Error('Invalid sponsor amount');
      const amount = BigInt(input.amountMicro);
      if (input.action === 'seed') {
        if (amount > BigInt(state.stableBalance)) throw new Error('Insufficient Safe stablecoin balance');
        fundingTransactions = [call(contracts.stable, approveAbi, 'approve', [contracts.engine, 0n]), call(contracts.stable, approveAbi, 'approve', [contracts.engine, amount]), call(contracts.engine, abis.engine, 'addProtocolLiquiditySeed', [amount]), call(contracts.stable, approveAbi, 'approve', [contracts.engine, 0n])];
      } else {
        if (amount > BigInt(state.sponsorReserve)) throw new Error('Withdrawal exceeds unallocated sponsor reserve');
        transaction = call(contracts.engine, abis.engine, 'rescueProtocolSeed', [amount]);
      }
    }
    if (input.action === 'enable') { if (state.moduleEnabled) throw new Error('Module is already enabled'); transaction = call(contracts.safe, managerSafeAbi, 'enableModule', [contracts.module]); }
    if (input.action === 'policy') { if (busy || state.pendingAuthorization !== '0') throw new Error('Active round or pending authorization blocks policy changes'); transaction = call(contracts.module, abis.module, 'configurePolicy', [Number(integer(input.slippageBps, 0, 1000))]); }
    if (input.action === 'authorize') {
      if (!state.moduleEnabled || busy || !state.oracle.usable || (state.stableBalance === '0' && state.assetBalance === '0')) throw new Error('Enable and fund the Safe, refresh the oracle and resolve any active round first');
      const trading = integer(input.tradingSeconds, 30, 86400); const evaluation = integer(input.evaluationSeconds, 60, 604800); const grace = integer(input.executionGraceSeconds, 1, 3600); const window = integer(input.twapWindowSeconds, 1, Number(trading));
      if (grace >= evaluation) throw new Error('Execution deadline must precede evaluation');
      const end = BigInt(state.timestamp) + trading;
      transaction = call(contracts.module, abis.module, 'authorizeRound', [BigInt(state.currentRoundId) + 1n, end, end + evaluation, end + grace, 950000000000000000n, 1050000000000000000n, window]);
    }
    if (input.action === 'revoke') { if (state.pendingAuthorization === '0') throw new Error('No pending authorization'); transaction = call(contracts.module, abis.module, 'revokeAuthorization', []); }
    if (input.action === 'disable') {
      if (!state.moduleEnabled) throw new Error('Module is not enabled');
      const sentinel = '0x0000000000000000000000000000000000000001'; let previous = sentinel; let cursor = sentinel; let found = false;
      for (let page = 0; page < 8 && !found; page++) {
        const [modules, next] = await read('safe', 'getModulesPaginated', [cursor, 50n], BigInt(state.blockNumber));
        for (const module of modules) { if (same(module, contracts.module)) { found = true; break; } previous = module; }
        if (found || same(next, sentinel)) break;
        cursor = next;
      }
      if (!found) throw new Error('Module predecessor could not be verified');
      transaction = call(contracts.safe, managerSafeAbi, 'disableModule', [previous, contracts.module]);
    }
    return { action: input.action, unsignedOnly: true, inspectedBlock: state.blockNumber, expiresAt: (BigInt(state.timestamp) + 300n).toString(), warning: 'Review with Safe owners. Sponsoring forecasting moves USDC out of the investment Safe; it is a separate explicit cost. Review multi-call funding as a batch, including approval cleanup. This file contains no signatures and does not execute automatically. Reinspect state before signing. Disabling execution does not settle an existing round.', safeTransactionBuilder: { version: '1.0', chainId: String(chainId), createdAt: Number(state.timestamp) * 1000, meta: { name: `Wavefund ${input.action}`, description: 'Owner-reviewed CALL only; forecasting collateral is separate from investment capital.', createdFromSafeAddress: contracts.safe, createdFromOwnerAddress: '' }, transactions: fundingTransactions ?? [transaction] } };
  }
  return { inspect, prepare };
}
