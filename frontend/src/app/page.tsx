"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, decodeState, DemoState, phaseIndex, returnPercent, units } from "@/lib/state";
import { AppShell } from "@/components/AppShell";
import { ActivityTable, AgentFeed, ForecasterTable, OutcomeSummary, PastRounds, ProposalList, RoundTimeline, roundStage } from "@/components/decide/DecideParts";
import { CopyText, Icon } from "@/components/funding/primitives";
import { Badge, Button, Card, CardHeader, DescriptionList, EmptyState, Notice, PageHeader, Skeleton, Stat, TabPanel, Tabs } from "@/components/ui";
import { loadRoundEvidence } from "@/lib/record/loader";
import type { TestnetRound } from "@/lib/record/model.mjs";

type RoundTab = "proposals" | "forecasters" | "reasoning" | "activity";

export default function RoundsPage() {
  const [data, setData] = useState<DemoState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<RoundTab>("proposals");
  const [past, setPast] = useState<TestnetRound[] | null>(null);
  const [pastError, setPastError] = useState<string | null>(null);
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
      if (mounted.current && requestId === requestSerial.current) { setData(next); setConnectionError(null); setUpdatedAt(new Date()); }
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
    async function poll() { await refresh(); if (!disposed) timer = setTimeout(poll, 1800); }
    void poll();
    return () => { disposed = true; mounted.current = false; clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    loadRoundEvidence().then((rounds) => { if (active) setPast(rounds); }, (error) => { if (active) setPastError(error instanceof Error ? error.message : "Past rounds are unavailable."); });
    return () => { active = false; };
  }, []);

  async function startRound() {
    setStarting(true); setActionError(null);
    try {
      const response = await fetch(apiUrl("/api/demo/start"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "omit", signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The local round could not be started.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The local round could not be started.");
    } finally { await refresh(); setStarting(false); }
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
  const stage = roundStage(data, { connected, loading });
  const returnText = settled ? returnPercent(data?.round?.realisedReturnX18) : "—";
  const hasRound = Boolean(data?.roundId && data.roundId !== "0");
  const buttonLabel = aurora ? "Owner execution through Safe" : starting ? "Starting local round…" : completed ? "Round complete" : data?.running ? "Running local round…" : interrupted ? "Reset required in CLI" : "Run local round";
  const dataNote = aurora ? "Read-only Aurora testnet contracts. This server never signs; owner actions go through the Safe."
    : modelDriven ? "Local chain with test assets and simulated prices. Agent decisions are model-generated; contract transactions are real."
    : "Local chain with test assets, simulated prices and scripted agents. Every contract transaction is real.";

  return <AppShell
    network={aurora ? { label: "Aurora testnet", chainId: 1313161555, tone: "testnet" } : { label: "Anvil local", chainId: 31337, tone: "local" }}
    status={{ label: connected ? (aurora ? "Testnet contracts" : "Local contracts") : loading ? "Connecting" : "API offline", tone: interrupted ? "warn" : connected ? "ok" : loading ? "pending" : "off" }}>

    <PageHeader title="Rounds"
      description="AI agents propose how the Safe should be allocated. Forecasters back or doubt each proposal with their own collateral, and the market's choice executes inside the owner's limits."
      meta={<><Badge tone={aurora ? "info" : "warning"}>{aurora ? "Testnet monitor" : "Local simulation"}</Badge><span>{dataNote}</span></>}
      actions={aurora ? <Badge>Read-only</Badge> : <Button variant={completed || interrupted ? "secondary" : "primary"} size="lg" icon={completed ? "check" : interrupted ? "alert" : "play"} loading={starting || Boolean(data?.running)} disabled={disabled} onClick={() => void startRound()}>{buttonLabel}</Button>} />

    {error ? <div className="page-notice"><Notice tone="warning" title={connected ? "The round needs attention" : "Local services are not ready"}><p>{error}</p>{!connected ? <p>Start the demo with <code>bash scripts/docker-demo/up.sh</code>. Balances appear once the API reads the deployed contracts.</p> : null}</Notice></div> : null}

    <div className="stats" aria-label="Balances">
      <Stat label={<><Icon name="safe" />Treasury (Safe)</>} value={data?.safe.valueUsdX18 == null ? units(data?.safe.stableBalance, 6) : `$${units(data.safe.valueUsdX18, 18)}`} unit={data?.safe.valueUsdX18 == null ? "USDC" : undefined}
        sub={`${units(data?.safe.stableBalance, 6)} USDC · ${units(data?.safe.assetBalance, 18, 5)} ${aurora ? "asset" : "test ETH"}`} />
      <Stat label={<><Icon name="users" />Forecast escrow</>} value={units(data?.forecast.escrow, 6)} unit="USDC" sub={`${units(data?.forecast.deposits, 6)} USDC deposited this round`} />
      <Stat label={<><Icon name="layers" />Sponsor reserve</>} value={units(data?.sponsor.reserve, 6)} unit="USDC" sub="Funds forecaster rewards" />
      <Stat label={<><Icon name="pulse" />Measured return</>} value={returnText} tone={returnText.startsWith("+") ? "pos" : returnText.startsWith("−") ? "neg" : undefined} sub={settled ? "Recorded at settlement" : "After settlement"} />
    </div>
    <p className="stats-note"><Icon name="shield" />Three separate balances, never pooled. Forecaster collateral and sponsor funds never touch the Safe's investments.</p>

    <section className="section" aria-labelledby="current-heading">
      <div className="section-title"><h2 id="current-heading">Current round</h2><p>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString("en-GB")}${connectionError ? " · connection lost" : ""}` : "Waiting for the local deployment"}</p></div>
      <div className="detail-layout">
        <div className="card round-card">
          <header className="round-head">
            <div>
              <span className="eyebrow">{aurora ? "Aurora testnet" : "Local rehearsal"}</span>
              <h3>{hasRound ? `Round ${data?.roundId}` : "No round yet"}</h3>
            </div>
            <Badge tone={stage.tone} dot>{stage.label}</Badge>
          </header>
          <Tabs idBase="round" label="Round details" value={tab} onChange={setTab} tabs={[
            { id: "proposals", label: "Proposals", count: data?.proposals.length ?? null },
            { id: "forecasters", label: "Forecasters", count: data?.forecast.participants?.length ?? null },
            { id: "reasoning", label: "Reasoning" },
            { id: "activity", label: "Activity", count: data?.receipts.length ?? null },
          ]} />
          <TabPanel idBase="round" tab={tab}>
            {!data ? <div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={56} />)}</div>
              : tab === "proposals" ? (data.proposals.length
                ? <><p className="panel-note"><Icon name="eye" />Market support is what forecasters' trades imply, not a promised return. A challenger must beat Hold's final-window average by more than 0.5 points.</p><ProposalList proposals={data.proposals} winner={winner} /></>
                : <EmptyState icon="chart" title="No proposals yet">{aurora ? "No proposals are recorded for the monitored round." : "Use Run local round above to create the Hold baseline and the competing allocations on-chain."}</EmptyState>)
              : tab === "forecasters" ? <ForecasterTable data={data} settled={settled} />
              : tab === "reasoning" ? <div className="card-body">
                <AgentFeed agents={data.agents} emptyText={aurora ? "Agent records are not attached to this monitoring server." : "Agent reasoning appears when the round runs."} />
                {data.inference ? <p className="panel-foot">Inference: {data.inference.mode}{data.inference.model ? ` · ${data.inference.model}` : ""} · {data.inference.status}. Hardware attestation is not verified.</p> : null}
                {data.agentRecords?.length ? <details className="feed-more"><summary>{data.agentRecords.length} decision records</summary>{data.agentRecords.map((record, index) => <p key={`${record.name}-${index}`}>{record.name} · {record.provider} · <code title={record.outputHash}>{record.outputHash.slice(0, 16)}…</code></p>)}</details> : null}
              </div>
              : <ActivityTable receipts={data.receipts} />}
          </TabPanel>
        </div>

        <aside className="detail-side">
          <Card><CardHeader title="Lifecycle" icon="route" />
            <div className="card-body">{aurora ? <p className="muted">On-chain round status: <b>{String(data?.round?.status ?? "no round")}</b>. Monitoring does not infer steps that are not recorded.</p>
              : <RoundTimeline current={currentPhase} running={Boolean(data?.running)} halted={interrupted} />}</div>
          </Card>
          <Card><CardHeader title="Outcome" icon="pulse" actions={<Badge tone={settled ? "success" : "neutral"}>{settled ? "Settled" : "Pending"}</Badge>} />
            <div className="card-body"><OutcomeSummary data={data} settled={settled} winner={winner} /></div>
          </Card>
          <Card><CardHeader title="Details" icon="layers" />
            <div className="card-body"><DescriptionList items={[
              { label: "Safe", value: data?.safe.address ? <CopyText value={data.safe.address} label="Safe address" /> : <span className="unavailable">Not deployed</span> },
              { label: "Network", value: aurora ? "Aurora testnet" : "Anvil local · 31337" },
              { label: "Agents", value: modelConfigured ? `${data?.inference?.mode} model` : aurora ? "Not attached" : "Scripted rehearsal" },
              { label: "Attestation", value: "Not verified" },
            ]} /></div>
          </Card>
        </aside>
      </div>
    </section>

    <section className="section" aria-labelledby="past-heading">
      <div className="section-title"><h2 id="past-heading">Past rounds on Aurora testnet</h2><Link className="link" href="/record">Agent track record<Icon name="arrow" /></Link></div>
      <Card>
        {past ? <PastRounds rounds={past} />
          : pastError ? <EmptyState icon="alert" title="Past rounds unavailable">{pastError}</EmptyState>
          : <div className="card-body stack">{[0, 1].map((i) => <Skeleton key={i} height={40} />)}</div>}
      </Card>
    </section>
  </AppShell>;
}
