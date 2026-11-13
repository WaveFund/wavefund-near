"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { localCtx } from "@/components/arena/stages";
import { RoundWorkspace } from "@/components/arena/workspace";
import { Icon } from "@/components/funding/primitives";
import { Button, EmptyState, Notice, Skeleton } from "@/components/ui";
import { Cap, Tip } from "@/components/v2";
import { useLocalState, useSavedRounds } from "@/lib/arena/hooks";
import { localJourney, localWorkspaceAccess, percentFromBps, shortReturnX18, type ParticipantView } from "@/lib/arena/model.mjs";
import "../round.css";

export default function LocalRoundPage() {
  const local = useLocalState(1500);
  const { rounds } = useSavedRounds();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const access = localWorkspaceAccess(local.data, { loading: local.loading, error: local.error });
  const journey = localJourney(local.data);
  const tidepool = rounds?.find((item) => item.stack.id === "tidepool") ?? rounds?.[rounds.length - 1] ?? null;
  const source = access.available ? { label: "Local simulation", tone: "local" as const, detail: "chain 31337", status: "ok" as const }
    : { label: local.data ? "Aurora testnet" : "Local simulation", tone: local.data ? "testnet" as const : "none" as const, detail: local.data ? "read-only" : "offline" };

  async function run() {
    setStarting(true); setActionError(null);
    const failure = await local.start();
    if (failure) setActionError(failure);
    setStarting(false);
  }

  if (local.loading && !local.data) return <AppShell source={{ label: "Local simulation", tone: "local", detail: "connecting", status: "pending" }}><div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} />)}</div></AppShell>;

  if (!access.available) {
    return <AppShell source={source}>
      <Link className="breadcrumb" href="/rounds"><Icon name="chevron" />Rounds</Link>
      <EmptyState icon="alert" title="Local simulation unavailable"
        action={<div className="rw-empty-actions">{tidepool ? <Link className="btn btn-primary" href={`/rounds/${tidepool.slug}`}>Open the completed testnet round<Icon name="arrow" /></Link> : <Link className="btn" href="/rounds">Back to rounds</Link>}</div>}>
        {access.reason}. The local simulation needs its own running backend. <Tip label="For developers">Run bash scripts/docker-demo/up.sh and reload.</Tip>
      </EmptyState>
    </AppShell>;
  }

  const state = local.data;
  const ctx = localCtx(state, journey);
  const winnerName = journey.winnerId === null ? null : journey.isHold ? "Hold" : journey.proposals.find((item) => item.id === journey.winnerId)?.name ?? null;
  const winnerBps = journey.proposals.find((item) => item.id === journey.winnerId)?.allocationBps;
  const participants = state?.forecast.participants ?? [];
  const depositors = participants.filter((item) => item.deposit !== "0").length;
  const current = journey.stages.find((item) => item.status === "current" || item.status === "halted");
  const people: ParticipantView[] = participants.map((item) => ({ name: item.name, scripted: true, deposit: item.deposit, redeemed: journey.complete ? item.payout : null, net: journey.complete ? item.profitLoss : null, abstained: false, reason: null, position: null }));
  const status = journey.complete ? "Settled" : journey.halted ? "Halted" : journey.running ? `Running · ${current?.label ?? "starting"}` : "Not started";

  return <AppShell source={source}>
    <Link className="breadcrumb" href="/rounds"><Icon name="chevron" />Rounds</Link>
    {actionError || state?.error ? <div className="page-notice"><Notice tone="warning" title="The local round needs attention"><p>{actionError ?? state?.error}</p></Notice></div> : null}
    <RoundWorkspace ctx={ctx}
      eyebrow="Local simulation · disposable chain 31337" title={<>Round {state?.roundId && state.roundId !== "0" ? state.roundId : "1"} · Local simulation</>}
      caps={<><Cap tone={journey.complete ? "ok" : journey.running ? "warn" : undefined}>{status}</Cap><Cap>Simulated prices</Cap><Cap>Scripted agents</Cap></>}
      actions={access.canStart ? <Button variant="primary" icon="play" loading={starting} onClick={() => void run()}>Run local simulation</Button> : undefined}
      metrics={[winnerName ? (winnerName === "Hold" ? "Hold selected" : `${percentFromBps(winnerBps ?? -1) ?? "—"} ETH selected`) : "No selection yet", journey.evaluated ? `${shortReturnX18(journey.returnX18)} measured` : "Not measured", `${depositors} ${depositors === 1 ? "forecaster" : "forecasters"}`]}
      summaryRows={[["Network", "Local chain 31337"], ["Status", status], ["Strategies", journey.proposals.length ? `${journey.proposals.length - 1} + Hold` : "—"], ["Selected", winnerName ?? "—"]]}
      participants={people}
      activityExtra={state?.messages?.length ? <section><h3 className="rw-h3">Event log</h3><ul className="feed-mini">{state.messages.map((item, index) => <li key={`${item.timestamp}-${index}`}><span>{item.stage}</span>{item.message}</li>)}</ul></section> : null} />
  </AppShell>;
}
