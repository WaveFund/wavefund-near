"use client";
import { useEffect, useState } from "react";
import { apiUrl, units } from "@/lib/state";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CopyText, Icon, type IconName } from "@/components/funding/primitives";
import { Badge, Button, Card, CardHeader, DescriptionList, EmptyState, Notice, PageHeader, Skeleton, Stat } from "@/components/ui";

type Manager = { chainId: number; blockNumber: string; contracts: { safe: string; module: string; engine: string }; owners: string[]; threshold: number; moduleEnabled: boolean; maxSlippageBps: number; activeRoundId: string; activeStatus: number | null; pendingAuthorization: string; currentRoundId: string; stableBalance: string; assetBalance: string; sponsorReserve: string; oracle: { usable: boolean }; unsignedOnly: boolean };
type Prepared = { action: string; unsignedOnly: boolean; inspectedBlock: string; expiresAt: string; warning: string; safeTransactionBuilder: { chainId: string; transactions: Array<{ to: string; value: string; data: string }> } };

const ACTIONS: Array<{ id: string; label: string; icon: IconName; hint: string }> = [
  { id: "policy", label: "Slippage policy", icon: "sliders", hint: "Set the module's maximum swap slippage." },
  { id: "enable", label: "Enable module", icon: "bolt", hint: "Enable the verified Trading Safe module on the Safe." },
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

  return <AppShell source={aurora ? { label: "Aurora testnet", tone: "testnet", detail: "read-only" } : { label: "Local simulation", tone: "local", detail: state ? `block ${state.blockNumber}` : loading ? "connecting" : "offline", status: state ? "ok" : loading ? "pending" : "off" }}>
    <PageHeader title="Advanced · owner tools"
      breadcrumb={<Link className="breadcrumb" href="/portfolio?tab=permissions"><Icon name="chevron" />Portfolio</Link>}
      description="For the demo Safe's owner. Inspect the Safe and module, then prepare one owner action as an unsigned Safe transaction to review and sign in the Safe itself. Nothing is signed or sent here."
      meta={<><Badge tone="warning">Unsigned only</Badge><span>Not part of the everyday flow · no automatic signatures or transfers</span></>}
      actions={<><Button icon="wallet" disabled={!state} onClick={() => void connect()}>Check wallet owner</Button><Button variant="primary" icon="shield" loading={loading} onClick={() => void refresh()}>Refresh checks</Button></>} />

    {error ? <div className="page-notice"><Notice tone="warning" title={state ? "Action failed" : "Local services are not ready"}><p>{error}</p></Notice></div> : null}
    {wallet ? <div className="page-notice"><Notice tone="neutral" icon="wallet"><p>{wallet}</p></Notice></div> : null}

    {!state ? <Card>{loading ? <div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}</div> : <EmptyState icon="safe" title="Contracts not reachable">No addresses, balances or permissions are assumed. Start the demo and refresh.</EmptyState>}</Card> : <>
      <div className="stats three" aria-label="Safe overview">
        <Stat label={<><Icon name="safe" />Safe investment capital</>} value={units(state.stableBalance, 6)} unit="USDC" sub={`${units(state.assetBalance, 18, 5)} investment asset`} />
        <Stat label={<><Icon name="bolt" />Execution module</>} value={state.moduleEnabled ? "Enabled" : "Disabled"} sub={`Max slippage ${state.maxSlippageBps / 100}% · oracle ${state.oracle.usable ? "usable" : "stale"}`} />
        <Stat label={<><Icon name="layers" />Sponsor reserve</>} value={units(state.sponsorReserve, 6)} unit="USDC" sub={`Round ${state.currentRoundId} · status ${state.activeStatus ?? "none"}`} />
      </div>

      <div className="detail-layout section">
        <Card>
          <CardHeader title="Prepare an owner action" icon="sliders" actions={<Badge tone="warning">Unsigned only</Badge>} />
          <div className="settings">
            <nav className="settings-nav" aria-label="Owner actions">
              {ACTIONS.map((item) => <button type="button" key={item.id} aria-current={item.id === action ? "true" : undefined} className={item.id === action ? "active" : undefined} onClick={() => { setAction(item.id); setPrepared(null); }}><Icon name={item.icon} />{item.label}</button>)}
            </nav>
            <div className="settings-body">
              <h3>{current.label}</h3>
              <p className="muted">{current.hint}</p>
              {action === "policy" && <label className="field">Slippage in basis points <small>100 = 1%, maximum 1000</small><input className="input" value={slippage} onChange={(e) => setSlippage(e.target.value)} type="number" min="0" max="1000" /></label>}
              {["seed", "withdraw-seed"].includes(action) && <label className="field">USDC amount <small>Funding reduces the Safe's investment balance. Only unallocated sponsorship can be returned.</small><input className="input" value={sponsorAmount} onChange={(e) => setSponsorAmount(e.target.value)} inputMode="decimal" /></label>}
              {action === "authorize" && <><DescriptionList items={[
                { label: "Trading window", value: "120 s" }, { label: "Averaging window", value: "30 s" }, { label: "Execution grace", value: "60 s" },
                { label: "Evaluation", value: "180 s" }, { label: "Payout bounds", value: "−5% / +5%" },
              ]} /><p className="panel-foot">Payout bounds do not limit investment losses. Preparing this authorization does not start a keeper.</p></>}
              <div><Button variant="primary" icon="receipt" loading={busy} disabled={busy} onClick={() => void prepare()}>{busy ? "Checking contracts…" : "Prepare unsigned transaction"}</Button></div>
              {prepared && <div className="stack">
                <Notice icon="shield"><p>{prepared.warning}</p><p>Prepared from block {prepared.inspectedBlock}. Refresh within five minutes; this advisory expiry is not a Safe signature deadline.</p></Notice>
                <div className="code-block"><div className="code-head"><span>Safe Transaction Builder JSON · chain {prepared.safeTransactionBuilder.chainId}</span><Button size="sm" icon="download" onClick={download}>Download</Button></div><pre>{JSON.stringify(prepared.safeTransactionBuilder, null, 2)}</pre></div>
              </div>}
            </div>
          </div>
        </Card>
        <aside className="detail-side">
          <Card><CardHeader title="Contract checks" icon="shield" actions={<Badge tone="success" dot>Bindings verified</Badge>} />
            <div className="card-body"><DescriptionList items={[
              { label: "Safe", value: <CopyText value={state.contracts.safe} label="Safe address" /> },
              { label: "Module", value: <CopyText value={state.contracts.module} label="module address" /> },
              { label: "Engine", value: <CopyText value={state.contracts.engine} label="engine address" /> },
              { label: "Owners", value: `${state.threshold} of ${state.owners.length} required` },
              { label: "Pending authorization", value: state.pendingAuthorization },
              { label: "Inspected at", value: `Block ${state.blockNumber}` },
            ]} /></div>
          </Card>
          <Card><CardHeader title="Maintenance" icon="eye" />
            <details className="disclosure first"><summary>Receipt recovery</summary><div className="disclosure-body"><p>Read the chain before deciding what happened. This never retries transactions or changes the journal.</p><Button size="sm" icon="eye" onClick={() => void inspect("/api/recovery", setAudit)}>Audit recorded transactions</Button>{audit && <div className="code-block"><pre>{audit}</pre></div>}</div></details>
            <details className="disclosure"><summary>Research snapshot</summary><div className="disclosure-body"><p>Public market research can inform agents. It cannot authorize oracle settlement.</p><Button size="sm" icon="eye" onClick={() => void inspect("/api/research", setResearch)}>Check research snapshot</Button>{research && <div className="code-block"><pre>{research}</pre></div>}</div></details>
          </Card>
        </aside>
      </div>
    </>}
    <p className="page-foot">Local single-Safe integration. Supporting another Safe requires its own deployed stack and funding.</p>
  </AppShell>;
}
