"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RoundFacts, savedCtx } from "@/components/arena/stages";
import { RoundWorkspace } from "@/components/arena/workspace";
import { Icon, useNow } from "@/components/funding/primitives";
import { EmptyState, Skeleton } from "@/components/ui";
import { Cap, Tip } from "@/components/v2";
import { useFreshCheck, useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { participantViews, roundSummary, savedJourney } from "@/lib/arena/model.mjs";
import { findRound } from "@/lib/record/model.mjs";
import "../round.css";

export default function RoundPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";
  const now = useNow();
  const { rounds, error } = useSavedRounds();
  const { demo } = useTidepoolDemo();
  const fresh = useFreshCheck();
  const { round, ambiguous } = findRound(rounds, id);
  const journey = round ? savedJourney(round, demo) : null;
  const summary = round ? roundSummary(round) : null;

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: "saved evidence" }}>
    <Link className="breadcrumb" href="/rounds"><Icon name="chevron" />Rounds</Link>
    {!rounds ? (error ? <EmptyState icon="alert" title="Saved rounds are unavailable">Saved rounds are unavailable because the Wavefund API is not responding. <Tip label="For developers">{error} Start the API or run bash scripts/docker-demo/up.sh.</Tip></EmptyState>
      : <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} />)}</div>)
    : !round || !journey || !summary ? <EmptyState icon="alert" title={ambiguous ? "Several rounds share that number" : "Round not found"}>
        {ambiguous ? "Round numbers repeat across engines. Pick the round by network, engine and round id:" : "No saved round matches this address."}
        <span className="chip-row" style={{ justifyContent: "center", marginTop: 12 }}>{rounds.map((item) => <Link key={item.slug} className="chip" href={`/rounds/${item.slug}`}>Round {item.roundId} · {item.stack.label}</Link>)}</span>
      </EmptyState>
    : <RoundWorkspace key={round.slug}
        ctx={savedCtx(round, journey, { fresh: fresh.fresh, freshing: fresh.freshing, onFresh: () => void fresh.run(), now })}
        eyebrow="Aurora testnet · saved testnet history" title={<>Round {round.roundId} · {round.stack.label}</>}
        caps={<><Cap tone="ok" icon="check">Settled</Cap><Cap icon="receipt">Saved evidence{round.date ? ` · ${round.date}` : ""}</Cap>
          {round.genuineModelCalls ? <Cap tone="ai" icon="spark">{round.genuineModelCalls} genuine AI calls</Cap> : null}
          {round.models > 1 ? <Cap title="Distinct models recorded per agent in this round">{round.models} models</Cap> : null}
          {round.scriptedForecasters ? <Cap>{round.scriptedForecasters} scripted forecasters</Cap> : null}
          {round.limitations.some((item) => item.startsWith("All forecast bets are explicitly SCRIPTED fixtures aimed at the pre-registered target")) ? <Cap icon="lock" title="Target fixed in SCHEDULE.md before the round ran">Pre-registered target</Cap> : null}
          {(() => { const artifact = round.limitations.find((item) => item.startsWith("Test-pool artifact")); return artifact ? <><Cap tone="warn" icon="alert">Test-pool artifact</Cap><Tip label="Why this return is not a market result">{artifact}</Tip></> : null; })()}</>}
        metrics={[summary.allocation ?? "Allocation unavailable", summary.measured ? `${summary.measured} measured` : "Not measured", summary.tradesText]}
        summaryRows={[["Network", "Aurora testnet"], ["Stack", round.stack.label], ["Strategies", `${summary.strategies} + Hold`], ["Selected", summary.selectedName],
          ["Measured", <span key="m" className="num">{summary.measured ?? "—"}</span>], ["Recorded trades", <span key="t" className="num">{summary.trades}</span>], ["Saved", round.date ?? "—"]]}
        participants={participantViews(round)} facts={<RoundFacts round={round} />} />}
  </AppShell>;
}
