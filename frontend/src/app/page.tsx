"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, decodeState, DemoState, phaseIndex, returnPercent, shortAddress, units } from "@/lib/state";
import { AppShell } from "@/components/AppShell";
import { AgentFeed, KpiTile, Lifecycle, MarketCard, OutcomeCard, ReceiptsTable } from "@/components/decide/DecideParts";
import { Icon, Pill } from "@/components/funding/primitives";

export default function Dashboard() {
  const [data, setData] = useState<DemoState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mounted = useRef(true);
  const requestSerial = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSerial.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(apiUrl("/api/state"), { cache: "no-store", credentials: "omit", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The local contracts are not ready yet.");
      const next = decodeState(body);
      if (mounted.current && requestId === requestSerial.current) {
        setData(next);
        setConnectionError(null);
        setUpdatedAt(new Date());
      }
    } catch (error) {
      if (mounted.current && requestId === requestSerial.current) setConnectionError(error instanceof Error && error.name !== "AbortError" ? error.message : "The local API did not respond. Check that the demo services are running.");
    } finally {
      clearTimeout(timeout);
      if (mounted.current && requestId === requestSerial.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    async function poll() {
      await refresh();
      if (!disposed) timer = setTimeout(poll, 1800);
    }
    void poll();
    return () => { disposed = true; mounted.current = false; clearTimeout(timer); };
  }, [refresh]);

  async function startRound() {
    setStarting(true);
    setActionError(null);
    try {
      const response = await fetch(apiUrl("/api/demo/start"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "omit", signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The local round could not be started.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The local round could not be started.");
    } finally {
      await refresh();
      setStarting(false);
    }
  }

  const aurora = data?.mode === "aurora-testnet-readonly";
  const modelConfigured = ["local", "near-ai"].includes(data?.inference?.mode ?? "");
  const modelDriven = modelConfigured && data?.inference?.status === "complete";
  const currentPhase = phaseIndex(data?.stage ?? "idle");
  const completed = ["completed", "complete", "redeemed"].includes(data?.stage ?? "");
  const interrupted = ["failed", "interrupted"].includes(data?.stage ?? "");
  const connected = data !== null && connectionError === null;
  const disabled = aurora || !connected || starting || Boolean(data?.running) || completed || interrupted;
  const settled = completed || ["3", "settled"].includes(String(data?.round?.status ?? "").toLowerCase());
  const winnerKnown = currentPhase >= 4 || ["2", "3", "4", "collapsed", "settled", "cancelled"].includes(String(data?.round?.status ?? "").toLowerCase());
  const winner = winnerKnown && data?.round?.winnerId != null ? String(data.round.winnerId) : null;
  const error = actionError ?? data?.error ?? connectionError;
  const stageText = aurora ? "Read-only monitoring" : loading ? "Connecting" : !connected ? "Waiting for local services" : completed ? "Round complete" : interrupted ? "Needs attention" : data?.running ? "Round in progress" : "Ready to run";
  const roundLabel = data?.roundId && data.roundId !== "0" ? `Round ${data.roundId}` : "No active round";
  const statusTone = interrupted ? "warn" : !connected ? (loading ? "pending" : "off") : "ok";
  const returnText = settled ? returnPercent(data?.round?.realisedReturnX18) : "—";

  return <AppShell
    network={aurora ? { label: "Aurora testnet", chainId: 1313161555, tone: "testnet" } : { label: "Anvil local", chainId: 31337, tone: "local" }}
    status={{ label: connected ? (aurora ? "Testnet contracts" : "Local contracts") : loading ? "Connecting" : "API offline", tone: statusTone }}>

    <div className={`mode-strip ${aurora ? "tone-testnet" : "tone-local"}`}>
      <span className="mode-label">{aurora ? "TESTNET MONITOR" : "LOCAL SIMULATION"}</span>
      <span>{aurora ? "Read-only Aurora contracts · no server signing · owner actions through Safe" : modelDriven ? "Test assets and prices · model-generated decisions · real local contract transactions" : modelConfigured ? "Test assets and prices · model inference configured · real local contract transactions" : "Test assets · simulated agents and prices · real local contract transactions"}</span>
    </div>

    <section className="hero-split">
      <div className="hero-copy">
        <span className="kicker">Step 02 · Market-guided decision</span>
        <h1>Competing views.<br /><span className="grad-text">One accountable decision.</span></h1>
        <p className="lede">AI strategies propose allocations for the manager’s Safe. Forecasters back their views with separate collateral in Uniswap v4 markets, and the winning allocation executes inside the owner’s rules.</p>
        <div className="hero-badges">
          <span><Icon name="safe" />Owner keeps custody</span>
          <span><Icon name="chart" />Market selects</span>
          <span><Icon name="receipt" />Every step on-chain</span>
          <Link href="/record" className="hero-record-link"><Icon name="trophy" />Testnet track record<Icon name="arrow" /></Link>
        </div>
      </div>
      <div className="card round-card">
        <div className="round-card-top">
          <span className="kicker muted">{aurora ? "Aurora monitoring" : "Your local rehearsal"}</span>
          <span className={`chip-status tone-${completed ? "ok" : interrupted ? "warn" : data?.running ? "pending" : connected ? "ok" : "off"}`}><i />{stageText}</span>
        </div>
        <h2>{data?.roundId && data.roundId !== "0" ? `Decision round ${data.roundId}` : "From proposal to payout"}</h2>
        <p>{aurora ? "Inspect the verified contract state. Prepare owner-reviewed actions in the manager console; this server never signs testnet transactions." : completed ? "The selected strategy has been measured and the forecasting positions redeemed. Review the receipts below." : interrupted ? "The runtime stopped safely. Review the error and receipts before resetting the local demo through the CLI." : "Run the complete cycle on disposable local accounts: proposals, forecasts, Safe execution, settlement and redemption. No wallet or real money needed."}</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void startRound()} disabled={disabled} aria-busy={starting || Boolean(data?.running)}>
          {starting || data?.running ? <span className="spinner" /> : <Icon name={completed ? "check" : "play"} />}
          <span>{aurora ? "Owner execution through Safe" : starting ? "Starting local round…" : completed ? "Round complete" : data?.running ? "Running local round…" : interrupted ? "Reset required in CLI" : "Run local round"}</span>
        </button>
        <div className="round-card-foot"><Icon name="clock" />{updatedAt ? `Snapshot ${updatedAt.toLocaleTimeString("en-GB")}${connectionError ? " · connection lost" : ""}` : "Waiting for the local deployment"}</div>
      </div>
    </section>

    {error && <aside className="alert alert-warn" role="alert"><Icon name="alert" /><div><b>{connected ? "The demo needs attention" : "Local services are not ready"}</b><p>{error}</p>{!connected && <p className="alert-sub">Start the local demo from the repository. Balances appear after the API reads the deployed contracts.</p>}</div></aside>}

    <section className="kpis" aria-label="Three separate balances and the round">
      <KpiTile icon="safe" tone="mint" label="Manager capital"
        value={data?.safe.valueUsdX18 == null ? units(data?.safe.stableBalance, 6) : `$${units(data.safe.valueUsdX18, 18)}`} unit={data?.safe.valueUsdX18 == null ? "USDC" : undefined}
        sub={<>{units(data?.safe.stableBalance, 6)} USDC · {units(data?.safe.assetBalance, 18, 5)} {aurora ? "asset" : "test ETH"}</>} />
      <KpiTile icon="users" tone="violet" label="Forecast escrow" value={units(data?.forecast.escrow, 6)} unit="USDC" sub={<>{units(data?.forecast.deposits, 6)} USDC deposited this round</>} />
      <KpiTile icon="layers" tone="amber" label="Sponsor seed" value={units(data?.sponsor.reserve, 6)} unit="USDC" sub="Unallocated protocol reserve" />
      <KpiTile icon="bolt" label="Round" value={data?.roundId && data.roundId !== "0" ? `#${data.roundId}` : "—"} sub={stageText} />
      <KpiTile icon="pulse" tone={returnText.startsWith("+") ? "up" : returnText.startsWith("−") ? "down" : "default"} label="Measured return"
        value={returnText} sub={settled ? "Recorded strategy return" : "After settlement"} />
    </section>
    <p className="capital-note"><Icon name="shield" />Three separate balances, never pooled: the manager’s Safe <code>{shortAddress(data?.safe.address)}</code>, forecaster escrow and explicitly funded sponsor seed.</p>

    <section className="card section-card" aria-labelledby="lifecycle-heading">
      <div className="card-head"><h2 id="lifecycle-heading" className="card-title"><Icon name="route" />Decision lifecycle</h2><Pill tone={completed ? "success" : data?.running ? "live" : "muted"}>{roundLabel}</Pill></div>
      <div className="card-pad"><Lifecycle current={currentPhase} aurora={aurora} status={String(data?.round?.status ?? "no round")} /></div>
    </section>

    <section className="section" aria-labelledby="markets-heading">
      <div className="section-head">
        <div><span className="kicker">Competing allocations</span><h2 id="markets-heading">Let the strategies make their case.</h2></div>
        <p>The market signal is a forecast, not a guaranteed investment return. A challenger must beat Hold’s final-window average by more than 0.5 points.</p>
      </div>
      {data?.proposals.length ? <div className="markets">{data.proposals.map((proposal) => <MarketCard key={proposal.id} proposal={proposal} selected={winner === String(proposal.id)} />)}</div>
        : <div className="card empty"><span className="empty-ico"><Icon name="chart" /></span><div><h3>No proposals to compare yet</h3><p>Run the local round to create the baseline and competing allocations on-chain. Market odds appear here as forecasters trade.</p></div></div>}
    </section>

    <div className="split">
      <section className="card" aria-labelledby="agents-heading">
        <div className="card-head">
          <h2 id="agents-heading" className="card-title"><Icon name="users" />Agents · visible reasoning</h2>
          <Pill tone={modelConfigured ? "live" : "fixture"}>{modelConfigured ? `${data?.inference?.mode} · ${data?.inference?.status}` : aurora ? "Records not attached" : "Deterministic rehearsal"}</Pill>
        </div>
        <div className="card-pad">
          <AgentFeed agents={data?.agents ?? []} emptyText={aurora ? "Agent execution records are not attached to this monitoring server. On-chain proposal rationales appear above." : modelConfigured ? "Validated model summaries will appear after inference completes. Research inputs and assets remain simulated." : "The local agents’ reasoning appears when the scenario runs. This rehearsal does not claim live AI inference."} />
          {data?.inference && modelDriven ? <p className="fine-print">Model: {data.inference.model}. Research inputs: {data.inference.evidenceSource ?? "not yet read"}. Response hashes are recorded; hardware attestation is not verified.</p> : null}
          {data?.agentRecords?.length ? <details className="agent-more"><summary>{data.agentRecords.length} validated decision records</summary>{data.agentRecords.map((record, index) => <p key={`${record.name}-${index}`}>{record.name} · {record.provider} · <code title={record.outputHash}>{record.outputHash.slice(0, 16)}</code></p>)}</details> : null}
        </div>
      </section>
      <OutcomeCard settled={settled} data={data} winner={winner} />
    </div>

    <section className="card section-card" aria-labelledby="receipts-heading">
      <div className="card-head"><h2 id="receipts-heading" className="card-title"><Icon name="receipt" />On-chain activity</h2><Pill tone="neutral">{data?.receipts.length ?? 0} receipts</Pill></div>
      <ReceiptsTable receipts={data?.receipts ?? []} />
    </section>
  </AppShell>;
}
