"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, decodeState, DemoState, phaseIndex, PHASES, probability, returnPercent, shortAddress, signedUnits, units } from "@/lib/state";

function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M3 19c4 0 4-8 8-8s4 12 8 12 4-10 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return <button className="hash-button" onClick={copy} title={`Copy ${hash}`} aria-label={`Copy transaction hash ${hash}`}>
    {copied ? "Copied" : shortAddress(hash)}<span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
  </button>;
}

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

  const modelConfigured = ["local", "near-ai"].includes(data?.inference?.mode ?? "");
  const modelDriven = modelConfigured && data?.inference?.status === "complete";
  const currentPhase = phaseIndex(data?.stage ?? "idle");
  const completed = ["completed", "complete", "redeemed"].includes(data?.stage ?? "");
  const interrupted = ["failed", "interrupted"].includes(data?.stage ?? "");
  const connected = data !== null && connectionError === null;
  const disabled = !connected || starting || Boolean(data?.running) || completed || interrupted;
  const settled = completed || ["3", "settled"].includes(String(data?.round?.status ?? "").toLowerCase());
  const winnerKnown = currentPhase >= 4 || ["2", "3", "4", "collapsed", "settled", "cancelled"].includes(String(data?.round?.status ?? "").toLowerCase());
  const winner = winnerKnown && data?.round?.winnerId != null ? String(data.round.winnerId) : null;
  const error = actionError ?? data?.error ?? connectionError;
  const stageText = loading ? "Connecting" : !connected ? "Waiting for local services" : completed ? "Round complete" : interrupted ? "Needs attention" : data?.running ? "Round in progress" : "Ready to run";

  return <main className="shell">
    <header className="masthead">
      <a className="brand" href="/" aria-label="Wavefund home"><span className="brand-mark"><WaveMark /></span><span>wavefund<span className="brand-period">.</span></span></a>
      <div className="header-right"><span className="network-tag">ANVIL <span>31337</span></span><span className={`connection ${connected ? "connected" : ""}`}><i />{connected ? "Local contracts connected" : "Local API offline"}</span></div>
    </header>

    <div className="simulation-notice"><span className="notice-label">LOCAL SIMULATION</span><span>{modelDriven ? "Test assets and prices · model-generated decisions · real local contract transactions" : modelConfigured ? "Test assets and prices · model inference configured · real local contract transactions" : "Test assets · simulated agents and prices · real local contract transactions"}</span></div>

    <section className="hero">
      <div className="hero-copy"><p className="eyebrow"><span />MARKET-GUIDED TREASURY DECISIONS</p><h1>Competing views.<br /><em>One accountable decision.</em></h1><p className="hero-description">A manager keeps control of their Safe. Strategies compete in a forecasting market. The selected allocation executes within the owner’s rules.</p></div>
      <div className="run-card">
        <div className="run-card-top"><span className="section-label">YOUR LOCAL REHEARSAL</span><span className={`status-pill ${interrupted ? "warning" : completed ? "complete" : ""}`}><i />{stageText}</span></div>
        <h2>{data?.roundId && data.roundId !== "0" ? `Decision round ${data.roundId}` : "From proposal to payout"}</h2>
        <p>{completed ? "The selected strategy has been measured and the forecasting positions redeemed. Review the receipts below." : interrupted ? "The runtime stopped safely. Review the error and receipts before resetting the local demo through the CLI." : "Run the complete cycle on disposable local accounts. No wallet connection or real money is needed."}</p>
        <button className="primary-button" onClick={() => void startRound()} disabled={disabled} aria-busy={starting || Boolean(data?.running)}>
          <span>{starting ? "Starting local round…" : completed ? "Round complete" : data?.running ? "Running local round…" : interrupted ? "Reset required in CLI" : "Run local round"}</span>{starting || data?.running ? <span className="spinner" /> : <Arrow />}
        </button>
        <div className="run-card-foot"><span className="small-dot" />{updatedAt ? `Snapshot ${updatedAt.toLocaleTimeString("en-GB")}${connectionError ? " · connection lost" : ""}` : "Waiting for the local deployment"}</div>
      </div>
    </section>

    {error && <aside className="error-notice" role="alert"><strong>{connected ? "The demo needs attention" : "Local services are not ready"}</strong><p>{error}</p>{!connected && <p className="muted">Start the local demo command from the repository. Balances will appear after the API reads the deployed contracts.</p>}</aside>}

    <section className="capital-section" aria-labelledby="capital-heading">
      <div className="section-heading"><div><p className="eyebrow quiet">THREE SEPARATE BALANCES</p><h2 id="capital-heading">Know whose money is moving.</h2></div><p className="heading-note">{connectionError && data ? "Showing the last confirmed snapshot." : "Read from the local chain. Never combined into one pool."}</p></div>
      <div className="capital-grid">
        <article className="capital-card manager"><div className="card-kicker"><span className="bucket-icon">01</span><span>MANAGER CAPITAL</span><span className="ownership-tag">Owner’s Safe</span></div><div className="balance">{data?.safe.valueUsdX18 == null ? units(data?.safe.stableBalance, 6) : units(data.safe.valueUsdX18, 18)}<span>{data?.safe.valueUsdX18 == null ? "USDC" : "USD value"}</span></div><div className="secondary-balance">{units(data?.safe.stableBalance, 6)} <span>USDC</span> + {units(data?.safe.assetBalance, 18, 5)} <span>test ETH</span></div><div className="card-divider" /><p>Only the approved allocation trades. Investment gains and losses stay with the manager.</p><div className="address-caption">SAFE <code title={data?.safe.address}>{shortAddress(data?.safe.address)}</code></div></article>
        <article className="capital-card forecast"><div className="card-kicker"><span className="bucket-icon">02</span><span>FORECAST ESCROW</span></div><div className="balance">{units(data?.forecast.escrow, 6)}<span>USDC</span></div><div className="secondary-balance">{units(data?.forecast.deposits, 6)} <span>USDC deposited this round</span></div><div className="card-divider" /><p>Forecaster deposits and active market seed. Only the selected world settles.</p><div className="address-caption">SEPARATE FROM INVESTMENT CAPITAL</div></article>
        <article className="capital-card sponsor"><div className="card-kicker"><span className="bucket-icon">03</span><span>SPONSOR SEED</span></div><div className="balance">{units(data?.sponsor.reserve, 6)}<span>USDC</span></div><div className="secondary-balance"><span>Unallocated protocol reserve</span></div><div className="card-divider" /><p>Seeds the forecasting markets. Seed in an active proposal is tracked separately by the engine.</p><div className="address-caption">EXPLICITLY FUNDED LIQUIDITY</div></article>
      </div>
    </section>

    <section className="lifecycle-panel" aria-labelledby="lifecycle-heading">
      <div className="panel-heading"><div><p className="eyebrow quiet">THE DECISION RECORD</p><h2 id="lifecycle-heading">Every step leaves a receipt.</h2></div><span className="round-tag">{data?.roundId && data.roundId !== "0" ? `ROUND ${data.roundId}` : "NO ACTIVE ROUND"}</span></div>
      <ol className="phase-list">{PHASES.map((phase, index) => {
        const done = currentPhase > index;
        const active = currentPhase === index;
        return <li key={phase.id} className={`${done ? "done" : ""} ${active ? "active" : ""}`}><span className="phase-node">{done ? "✓" : String(index + 1).padStart(2, "0")}</span><span className="phase-name">{phase.label}</span><span className="phase-detail">{phase.detail}</span></li>;
      })}</ol>
    </section>

    <section className="markets-section" aria-labelledby="strategies-heading">
      <div className="section-heading"><div><p className="eyebrow quiet">COMPETING ALLOCATIONS</p><h2 id="strategies-heading">Let the strategies make their case.</h2></div><p className="heading-note">The market signal is a forecast,<br />not a guaranteed investment return.</p></div>
      {data?.proposals.length ? <div className="proposal-grid">{data.proposals.map((proposal) => {
        const selected = winner === String(proposal.id);
        const hold = String(proposal.id) === "0";
        const allocation = Number.isFinite(Number(proposal.allocationBps)) ? Number(proposal.allocationBps) / 100 : null;
        return <article className={`proposal-card ${selected ? "selected" : ""}`} key={proposal.id}>
          <div className="proposal-top"><span className="proposal-index">PROPOSAL {proposal.id}</span>{selected && <span className="selected-badge">✓ Market selected</span>}</div>
          <h3>{proposal.label || (hold ? "Hold current investments" : `Allocation ${proposal.id}`)}</h3><p className="proposal-description">{hold ? "Keep the existing token quantities. No rebalance is forced." : allocation === null ? "Allocation unavailable" : `${allocation.toFixed(0)}% test ETH · ${(100 - allocation).toFixed(0)}% USDC`}</p>
          <div className="signal-row"><div><span className="section-label">LONG MARKET SIGNAL</span><strong>{probability(proposal.probabilityX18)}</strong></div><div className="signal-mini"><span>Final-window average</span><b>{probability(proposal.twapX18)}</b></div></div>
          <div className="signal-track" aria-hidden="true"><span style={{ width: proposal.probabilityX18 && /^\d+$/.test(proposal.probabilityX18) ? `${Math.min(100, Number(BigInt(proposal.probabilityX18) / 10n ** 14n) / 100)}%` : "0%" }} /></div>
          <p className="rationale">{proposal.rationale || "No rationale has been recorded for this proposal."}</p>
        </article>;
      })}</div> : <div className="empty-panel"><span className="empty-icon">↗</span><div><h3>No proposals to compare yet</h3><p>Run the local round to create the baseline and competing allocations onchain. Market signals will appear here as forecasters trade.</p></div></div>}
    </section>

    <div className="insight-grid">
      <section className="agents-panel" aria-labelledby="agents-heading"><div className="panel-heading"><div><p className="eyebrow quiet">{modelConfigured ? "AGENT RESEARCH" : data?.inference?.mode === "test-fixture" ? "TEST MODEL RESPONSES" : "SIMULATED AGENTS"}</p><h2 id="agents-heading">Different views, visible reasoning.</h2></div><span className="text-tag">{modelConfigured ? `${data?.inference?.mode} · ${data?.inference?.status}` : "DETERMINISTIC REHEARSAL"}</span></div>{data?.agents.length ? <div className="agent-list">{data.agents.map((agent, index) => <article className="agent-row" key={`${agent.name}-${index}`}><span className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</span><div><div className="agent-title"><h3>{agent.name}</h3><span>{agent.role}</span></div><p>{agent.rationale || agent.action || "Waiting for a recorded decision."}</p>{agent.action && agent.rationale && <span className="agent-action">{agent.action}</span>}{(agent.forecasts?.length || agent.risks?.length) ? <details className="agent-evidence"><summary>Forecasts and risks</summary>{agent.forecasts?.map((forecast) => <div key={forecast.proposalId}><strong>Proposal #{forecast.proposalId}: {forecast.expectedReturnBps >= 0 ? "+" : ""}{(forecast.expectedReturnBps / 100).toFixed(2)}% expected return</strong><p>{forecast.rationale}</p><small>Self-reported confidence {(forecast.confidenceBps / 100).toFixed(0)}% · {forecast.risks.join("; ")}</small></div>)}{agent.risks?.map((risk) => <p key={risk}>{risk}</p>)}{agent.evidenceIds?.length ? <small>Evidence: {agent.evidenceIds.join(", ")}</small> : null}</details> : null}</div></article>)}</div> : <p className="panel-empty">{modelConfigured ? "Validated model summaries will appear after inference completes. Research inputs and assets remain simulated." : "The local agents’ reasoning will appear when the scenario runs. This rehearsal does not claim live AI inference."}</p>}{data?.inference && modelDriven ? <p className="outcome-note">Model: {data.inference.model}. Research inputs: {data.inference.evidenceSource ?? "not yet read"}. Response hashes are recorded; hardware attestation is not verified.</p> : null}{data?.agentRecords?.length ? <details className="agent-evidence"><summary>{data.agentRecords.length} validated decision records</summary>{data.agentRecords.map((record, index) => <p key={`${record.name}-${index}`}>{record.name} · {record.provider} · <code title={record.outputHash}>{record.outputHash.slice(0, 16)}</code></p>)}</details> : null}</section>
      <section className="outcome-panel" aria-labelledby="outcome-heading"><p className="eyebrow quiet">MEASURED OUTCOME</p><h2 id="outcome-heading">Performance closes the loop.</h2><div className="performance-value">{settled ? returnPercent(data?.round?.realisedReturnX18) : "—"}</div><p className="performance-caption">{settled ? "Recorded strategy return" : "Available after performance settlement"}</p><div className="outcome-rule" /><div className="outcome-detail"><span>Selected proposal</span><strong>{winner === null ? "Not selected" : `#${winner}`}</strong></div><div className="outcome-detail"><span>LONG payout ratio</span><strong>{settled ? probability(data?.round?.piX18) : "Not settled"}</strong></div>{settled && data?.forecast.participants?.length ? <div className="forecaster-results"><span className="section-label">FORECASTER RESULT · SEPARATE COLLATERAL</span>{data.forecast.participants.map((person) => <div className="forecaster-result" key={person.address}><span>{person.name}</span><strong>{signedUnits(person.profitLoss, 6)} <small>USDC</small></strong></div>)}</div> : null}<p className="outcome-note">Payout bounds shape forecaster rewards. They are not a stop loss on the manager’s investments.</p></section>
    </div>

    <section className="receipts-panel" aria-labelledby="receipts-heading"><div className="panel-heading"><div><p className="eyebrow quiet">ONCHAIN ACTIVITY</p><h2 id="receipts-heading">Inspect the actual transactions.</h2></div><span className="receipt-count">{data?.receipts.length ?? 0} RECEIPTS</span></div>{data?.receipts.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Transaction</th><th>Block</th><th>Status</th></tr></thead><tbody>{[...data.receipts].reverse().map((receipt, index) => <tr key={`${receipt.hash}-${index}`}><td>{receipt.label}</td><td><CopyHash hash={receipt.hash} /></td><td className="mono">{receipt.blockNumber ?? "—"}</td><td><span className={`receipt-status ${["success", "confirmed"].includes(receipt.status) ? "success" : ["failed", "reverted"].includes(receipt.status) ? "failed" : "pending"}`}><i />{receipt.status}</span></td></tr>)}</tbody></table></div> : <p className="panel-empty">No transactions recorded yet. Receipts appear after actual local contract calls; none are generated for display.</p>}</section>

    <footer><a className="footer-brand" href="/">wavefund.</a><p>A local rehearsal of the Aurora trading-Safe model. Test ETH is a simulated asset.<br />Live oracle access, public deployment and real trading liquidity are separate verification steps.</p><span>OWNER CONTROL.<br />MARKET CONVICTION.</span></footer>
  </main>;
}
