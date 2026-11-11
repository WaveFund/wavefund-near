"use client";
import { useEffect, useState } from "react";
import { apiUrl, units } from "@/lib/state";
import { AppShell } from "@/components/AppShell";
import { CopyText, Icon, Pill, type IconName } from "@/components/funding/primitives";

type Manager = { chainId: number; blockNumber: string; contracts: { safe: string; module: string; engine: string }; owners: string[]; threshold: number; moduleEnabled: boolean; maxSlippageBps: number; activeRoundId: string; activeStatus: number | null; pendingAuthorization: string; currentRoundId: string; stableBalance: string; assetBalance: string; sponsorReserve: string; oracle: { usable: boolean }; unsignedOnly: boolean };
type Prepared = { action: string; unsignedOnly: boolean; inspectedBlock: string; expiresAt: string; warning: string; safeTransactionBuilder: { chainId: string; transactions: Array<{ to: string; value: string; data: string }> } };

const ACTIONS: Array<{ id: string; label: string; icon: IconName; hint: string }> = [
  { id: "policy", label: "Slippage policy", icon: "sliders", hint: "Set the module's maximum swap slippage." },
  { id: "enable", label: "Enable module", icon: "bolt", hint: "Enable the verified Trading Safe module on your Safe." },
  { id: "seed", label: "Fund sponsorship", icon: "layers", hint: "Move USDC from the Safe into the forecasting sponsor reserve." },
  { id: "withdraw-seed", label: "Return sponsorship", icon: "refund", hint: "Return unallocated sponsorship to the Safe." },
  { id: "authorize", label: "Authorize round", icon: "check", hint: "Approve exact timing and payout bounds for the next round." },
  { id: "revoke", label: "Revoke authorization", icon: "cross", hint: "Cancel a pending round authorization." },
  { id: "disable", label: "Disable module", icon: "lock", hint: "Disable the module. Does not settle an existing round." },
];

export default function ManagerPage() {
  const [state, setState] = useState<Manager | null>(null); const [error, setError] = useState<string | null>(null); const [action, setAction] = useState("policy"); const [slippage, setSlippage] = useState("100"); const [sponsorAmount, setSponsorAmount] = useState("100"); const [prepared, setPrepared] = useState<Prepared | null>(null); const [busy, setBusy] = useState(false); const [wallet, setWallet] = useState<string | null>(null); const [audit, setAudit] = useState<string | null>(null); const [research, setResearch] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    try { const response = await fetch(apiUrl('/api/manager'), { cache: 'no-store', signal: AbortSignal.timeout(15000) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Manager inspection failed'); if (![31337, 1313161555].includes(body.chainId) || body.unsignedOnly !== true || !Array.isArray(body.owners)) throw new Error('Invalid manager network or response'); setState(body); setError(null); } catch (e) { setError((e as Error).message); setState(null); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function prepare() {
    setBusy(true); setPrepared(null); setError(null);
    try {
      if (['seed', 'withdraw-seed'].includes(action) && !/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(sponsorAmount)) throw new Error('Enter a positive USDC amount with at most six decimals.');
      const [whole, fraction = ''] = sponsorAmount.split('.');
      const amountMicro = ['seed', 'withdraw-seed'].includes(action) ? (BigInt(whole || '0') * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString() : '0';
      const input = ['seed', 'withdraw-seed'].includes(action) ? { action, amountMicro } : action === 'policy' ? { action, slippageBps: Number(slippage) } : action === 'authorize' ? { action, tradingSeconds: 120, evaluationSeconds: 180, executionGraceSeconds: 60, twapWindowSeconds: 30 } : { action };
      const response = await fetch(apiUrl('/api/manager/prepare'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Preparation failed'); if (body.unsignedOnly !== true || body.safeTransactionBuilder?.chainId !== String(state?.chainId)) throw new Error('Unexpected transaction network'); setPrepared(body);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function connect() {
    try {
      const provider = (window as Window & { ethereum?: { request(args: { method: string }): Promise<unknown> } }).ethereum;
      if (!provider) throw new Error('No browser wallet found. Wallet connection is optional; Safe owners can review the unsigned JSON directly.');
      const id = await provider.request({ method: 'eth_chainId' }); if (Number(BigInt(String(id))) !== state?.chainId) throw new Error(`Select chain ${state?.chainId} in your wallet first.`);
      const accounts = await provider.request({ method: 'eth_requestAccounts' }); if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('No account returned');
      setWallet(state.owners.some((owner) => owner.toLowerCase() === accounts[0].toLowerCase()) ? `${accounts[0]} is a Safe owner. Threshold remains ${state.threshold}.` : `${accounts[0]} is not an owner of this Safe.`);
    } catch (e) { setError((e as Error).message); }
  }
  function download() { if (!prepared) return; const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.safeTransactionBuilder, null, 2)], { type: 'application/json' })); link.href = url; link.download = `wavefund-${prepared.action}-unsigned.json`; link.click(); URL.revokeObjectURL(url); }
  async function inspect(path: string, setter: (value: string) => void) { try { const response = await fetch(apiUrl(path), { cache: 'no-store', signal: AbortSignal.timeout(30000) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Inspection failed'); setter(JSON.stringify(body, null, 2)); } catch (e) { setError((e as Error).message); } }
  const current = ACTIONS.find((item) => item.id === action) ?? ACTIONS[0];
  const aurora = state?.chainId === 1313161555;

  return <AppShell
    network={aurora ? { label: "Aurora testnet", chainId: 1313161555, tone: "testnet" } : { label: "Anvil local", chainId: state?.chainId ?? 31337, tone: "local" }}
    status={{ label: state ? `Block ${state.blockNumber}` : loading ? "Connecting" : "API offline", tone: state ? "ok" : loading ? "pending" : "off" }}>
    <div className="mode-strip tone-owner"><span className="mode-label">OWNER REVIEW</span><span>Unsigned transaction preparation · no automatic wallet signatures or fund transfers</span></div>

    <section className="hero-split">
      <div className="hero-copy">
        <span className="kicker">Step 03 · Manager console</span>
        <h1>Your Safe.<br /><span className="grad-text">Your boundaries.</span></h1>
        <p className="lede">Inspect the deployed module, prepare one owner action, then review and sign it in your Safe. Investment funds stay separate from forecasting collateral.</p>
      </div>
      <div className="card round-card">
        <div className="round-card-top"><span className="kicker muted">Contract checks</span><span className={`chip-status tone-${state ? "ok" : loading ? "pending" : "off"}`}><i />{state ? "Bindings verified" : loading ? "Checking" : "Unavailable"}</span></div>
        <h2>{state ? `Chain ${state.chainId}` : "Connecting to contracts"}</h2>
        <p>{state ? `Safe threshold ${state.threshold} of ${state.owners.length} owner(s). Inspected at block ${state.blockNumber}.` : "No addresses, balances or permissions are assumed."}</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void refresh()} disabled={loading}>{loading ? <span className="spinner" /> : <Icon name="shield" />}<span>Refresh contract checks</span></button>
        <button type="button" className="btn btn-ghost full" disabled={!state} onClick={() => void connect()}><Icon name="wallet" />Check browser wallet owner</button>
        {wallet && <p className="round-card-foot">{wallet}</p>}
      </div>
    </section>

    {error && <aside className="alert alert-warn" role="alert"><Icon name="alert" /><div><b>{state ? "Action failed" : "Local services are not ready"}</b><p>{error}</p></div></aside>}

    {state && <>
      <section className="kpis three" aria-label="Safe overview">
        <article className="card kpi tone-mint"><span className="kpi-label"><Icon name="safe" />Safe investment capital</span><span className="kpi-value">{units(state.stableBalance, 6)}<small>USDC</small></span><span className="kpi-sub">{units(state.assetBalance, 18, 5)} investment asset</span><span className="kpi-address"><CopyText value={state.contracts.safe} label="Safe address" /></span></article>
        <article className="card kpi tone-violet"><span className="kpi-label"><Icon name="bolt" />Execution module</span><span className="kpi-value">{state.moduleEnabled ? "Enabled" : "Disabled"}</span><span className="kpi-sub">Max slippage {state.maxSlippageBps / 100}% · oracle {state.oracle.usable ? "usable" : "stale"}</span><span className="kpi-address"><CopyText value={state.contracts.module} label="module address" /></span></article>
        <article className="card kpi tone-amber"><span className="kpi-label"><Icon name="layers" />Sponsor reserve</span><span className="kpi-value">{units(state.sponsorReserve, 6)}<small>USDC</small></span><span className="kpi-sub">Round {state.currentRoundId} · pending authorization {state.pendingAuthorization} · status {state.activeStatus ?? "none"}</span></article>
      </section>

      <section className="card section-card" aria-labelledby="action-heading">
        <div className="card-head"><h2 id="action-heading" className="card-title"><Icon name="sliders" />Prepare one owner action</h2><Pill tone="warning">Unsigned only</Pill></div>
        <div className="card-pad">
          <div className="action-tabs" role="tablist" aria-label="Owner action">
            {ACTIONS.map((item) => <button type="button" role="tab" aria-selected={item.id === action} key={item.id} className={item.id === action ? "active" : undefined} onClick={() => { setAction(item.id); setPrepared(null); }}><Icon name={item.icon} />{item.label}</button>)}
          </div>
          <div className="action-body">
            <p className="action-hint"><Icon name={current.icon} />{current.hint}</p>
            {action === 'policy' && <label className="field">Slippage in basis points <small>100 = 1%, maximum 1000</small><input value={slippage} onChange={(e) => setSlippage(e.target.value)} type="number" min="0" max="1000" /></label>}
            {['seed', 'withdraw-seed'].includes(action) && <label className="field">USDC amount <small>Funding reduces the investment Safe balance. Only unallocated sponsorship can be returned.</small><input value={sponsorAmount} onChange={(e) => setSponsorAmount(e.target.value)} inputMode="decimal" /></label>}
            {action === 'authorize' && <div className="terms"><span><b>120s</b>trading</span><span><b>30s</b>averaging</span><span><b>60s</b>execution grace</span><span><b>180s</b>evaluation</span><span><b>−5% / +5%</b>payout bounds</span><p>Payout bounds do not limit investment losses. Preparing this authorization does not start a keeper.</p></div>}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void prepare()}>{busy ? <span className="spinner" /> : <Icon name="receipt" />}<span>{busy ? 'Checking contracts…' : 'Prepare unsigned transaction'}</span></button>
          </div>
          {prepared && <div className="prepared">
            <p className="alert alert-info"><Icon name="shield" /><span>{prepared.warning}</span></p>
            <p className="fine-print">Prepared from block {prepared.inspectedBlock}. Refresh within five minutes; this advisory expiry is not a Safe signature deadline.</p>
            <div className="code-block"><div className="code-head"><span>Safe Transaction Builder JSON · chain {prepared.safeTransactionBuilder.chainId}</span><button type="button" className="btn btn-ghost small" onClick={download}><Icon name="download" />Download</button></div><pre>{JSON.stringify(prepared.safeTransactionBuilder, null, 2)}</pre></div>
          </div>}
        </div>
      </section>
    </>}

    <section className="split">
      <article className="card"><div className="card-head"><h2 className="card-title"><Icon name="receipt" />Receipt recovery</h2></div><div className="card-pad"><p className="muted-note">Read the chain before deciding what happened. This tool never retries transactions or changes the journal.</p><button type="button" className="btn btn-ghost" onClick={() => void inspect('/api/recovery', setAudit)}><Icon name="eye" />Audit recorded transactions</button>{audit && <div className="code-block"><pre>{audit}</pre></div>}</div></article>
      <article className="card"><div className="card-head"><h2 className="card-title"><Icon name="chart" />Research data</h2></div><div className="card-pad"><p className="muted-note">Public market research can inform agents. It cannot authorize oracle settlement.</p><button type="button" className="btn btn-ghost" onClick={() => void inspect('/api/research', setResearch)}><Icon name="eye" />Check research snapshot</button>{research && <div className="code-block"><pre>{research}</pre></div>}</div></article>
    </section>
    <p className="fine-print center">Local single-Safe integration. Supporting another Safe requires its own deployed stack and funding. No universal vault compatibility is claimed.</p>
  </AppShell>;
}
