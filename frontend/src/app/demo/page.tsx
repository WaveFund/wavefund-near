"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Chip, JourneyTrack } from "@/components/arena/parts";
import { LocalRoundStory } from "@/components/arena/story";
import { Icon } from "@/components/funding/primitives";
import { Button, Notice } from "@/components/ui";
import { useLocalState, useSavedRounds } from "@/lib/arena/hooks";
import { localJourney } from "@/lib/arena/model.mjs";

export default function DemoPage() {
  const local = useLocalState(1200);
  const { rounds } = useSavedRounds();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const journey = localJourney(local.data);
  const tidepool = rounds?.find((item) => item.stack.id === "tidepool") ?? null;
  const stage = local.data?.stage ?? "idle";
  const aurora = local.data?.mode === "aurora-testnet-readonly";
  const current = journey.stages.find((item) => item.status === "current" || item.status === "halted");
  const latest = local.data?.messages?.length ? local.data.messages[local.data.messages.length - 1] : null;
  const canStart = local.connected && !aurora && stage === "idle" && !local.data?.running && !starting;
  const label = starting ? "Starting…" : journey.complete ? "Round complete" : journey.halted ? "Needs a fresh start" : journey.running ? "Running…" : "Run local demo";
  const status = !local.data ? (local.loading ? { text: "Connecting", tone: "plain" as const } : { text: "Offline", tone: "plain" as const })
    : journey.complete ? { text: "Complete", tone: "ok" as const } : journey.halted ? { text: "Needs attention", tone: "local" as const }
    : journey.running ? { text: `Running · ${current?.label ?? "starting"}`, tone: "live" as const } : { text: "Ready to run", tone: "plain" as const };

  async function run() {
    setStarting(true); setActionError(null);
    const failure = await local.start();
    if (failure) setActionError(failure);
    setStarting(false);
  }

  return <AppShell source={aurora ? { label: "Aurora testnet", tone: "testnet", detail: "read-only" } : { label: "Local simulation", tone: "local", detail: local.connected ? "chain 31337" : local.loading ? "connecting" : "offline", status: local.connected ? "ok" : local.loading ? "pending" : "off" }}>
    <div className="round-hero">
      <div className="mode-switch" role="tablist" aria-label="Demo mode">
        <span className="active" role="tab" aria-selected="true"><Icon name="play" />Local simulation</span>
        <Link role="tab" aria-selected="false" href={tidepool ? `/rounds/${tidepool.slug}` : "/arena"}><Icon name="receipt" />Completed testnet run</Link>
      </div>
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Run a full round on a local chain</h1>
          <p className="lede">Real contracts on a disposable local chain, with simulated prices and scripted agents. Watch each step happen as the backend reports it.</p>
          <div className="chip-row" style={{ marginTop: 12 }}><Chip tone="local">Local chain 31337</Chip><Chip tone="plain">Simulated prices</Chip><Chip tone="plain">Scripted agents</Chip><Chip tone="plain">No model calls</Chip></div>
        </div>
        {aurora ? null : <Button variant={canStart ? "primary" : "secondary"} size="lg" icon={journey.complete ? "check" : journey.halted ? "alert" : "play"} loading={starting || journey.running} disabled={!canStart} onClick={() => void run()}>{label}</Button>}
      </div>
    </div>

    {actionError || (!local.data && !local.loading) || local.data?.error ? <div className="page-notice"><Notice tone="warning" title={local.data ? "The round needs attention" : "The local demo is not running"}>
      <p>{actionError ?? local.data?.error ?? local.error}</p>{!local.data ? <p>Start it with <code>bash scripts/docker-demo/up.sh</code>, then reload this page.</p> : null}</Notice></div> : null}
    {journey.complete ? <p className="quiet-note" style={{ marginBottom: 16 }}><Icon name="check" /><span><b>This local round has finished.</b> To run it again, restart the demo with <code>bash scripts/docker-demo/up.sh --fresh</code>. That resets only the local chain, never public testnet history.</span></p> : null}

    <div className="track-card sticky" aria-live="polite">
      <div className="track-card-head"><h2>Round {local.data?.roundId && local.data.roundId !== "0" ? local.data.roundId : "1"} · local simulation</h2><Chip tone={status.tone}>{status.text}</Chip></div>
      <JourneyTrack stages={journey.stages} label="Local round journey" />
      {latest ? <p className="subtle" style={{ marginTop: 14, fontSize: 12.5 }}><b style={{ color: "var(--text-2)", textTransform: "capitalize" }}>{latest.stage}:</b> {latest.message}</p> : null}
    </div>

    <div style={{ marginTop: 16 }}><LocalRoundStory state={local.data} journey={journey} /></div>

    {local.data?.messages?.length ? <details className="tech card" style={{ marginTop: 16 }}><summary><Icon name="chevron" />Event log from the local backend</summary>
      <div className="tech-body"><ul className="feed-mini">{local.data.messages.map((item, index) => <li key={`${item.timestamp}-${index}`}><span>{item.stage}</span>{item.message}</li>)}</ul></div></details> : null}
  </AppShell>;
}
