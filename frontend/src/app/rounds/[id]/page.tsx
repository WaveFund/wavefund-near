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
import { participantViews, percentFromBps, roundSummary, roundWindows, savedJourney, settlementShares } from "@/lib/arena/model.mjs";
import { findRound, formatReturnX18 } from "@/lib/record/model.mjs";
import { roundProvenance, shortModel, TEE_LABELS, TEE_TIPS } from "@/lib/record/provenance.mjs";

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
  const prov = round ? roundProvenance(round) : null;

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
        eyebrow={<>Aurora testnet · {round.stack.label}{round.date ? ` · ${round.date}` : ""}</>} title={<>Round {round.roundId}</>}
        caps={<><Cap tone="ok" icon="check">Settled</Cap><Cap icon="receipt">Saved evidence{round.date ? ` · ${round.date}` : ""}</Cap>
          {round.genuineModelCalls ? <Cap tone="ai" icon="spark">{round.genuineModelCalls} genuine AI calls</Cap> : null}
          {prov && prov.models.length === 1 ? <Cap title={`Every model call in this round used ${prov.models[0]}`}>{shortModel(prov.models[0])}</Cap>
            : prov && prov.models.length > 1 ? <Cap title={prov.models.join(", ")}>{prov.models.length} models</Cap> : null}
          {prov ? (prov.tee === "verified" ? <Cap tone="ai" icon="shield" title={TEE_TIPS.verified}>{prov.verified} of {prov.challengers} proposals TEE verified</Cap>
            : prov.tee === "before-tee" ? <Cap title={TEE_TIPS["before-tee"]}>{TEE_LABELS["before-tee"]}</Cap>
            : <Cap title={TEE_TIPS["not-attested"]}>{prov.tee === "partial" ? `${prov.verified} of ${prov.challengers} proposals TEE verified` : TEE_LABELS["not-attested"]}</Cap>) : null}
          {round.scriptedForecasters ? <Cap>{round.scriptedForecasters} scripted forecasters</Cap> : null}
          {round.limitations.some((item) => item.startsWith("All forecast bets are explicitly SCRIPTED fixtures aimed at the pre-registered target")) ? <Cap icon="lock" title="Target fixed in SCHEDULE.md before the round ran">Pre-registered target</Cap> : null}
          {(() => { const artifact = round.limitations.find((item) => item.startsWith("Test-pool artifact")); return artifact ? <><Cap tone="warn" icon="alert">Test-pool artifact</Cap><Tip label="Why this return is not a market result">{artifact}</Tip></> : null; })()}</>}
        metrics={(() => {
          const measured = formatReturnX18(round.realisedReturnX18); const shares = settlementShares(round.market?.longPayoutX18); const windows = roundWindows(round.market);
          const abstained = round.forecasters.filter((item) => item.action === "abstain").length;
          return [
            { label: "Selected", value: summary.selectedName, avatar: { name: summary.selectedName, hold: summary.isHold }, sub: summary.isHold ? "kept the allocation" : `${percentFromBps(round.winner.allocationBps)} ETH target` },
            { label: "Measured return", value: measured ?? "Not measured", tone: measured?.startsWith("−") ? "neg" as const : measured?.startsWith("+") ? "pos" as const : null, sub: windows?.evaluation ? `over ${windows.evaluation} · test assets` : "test assets" },
            { label: "LONG settled at", value: shares?.long ?? "—", sub: shares ? `SHORT ${shares.short}` : "not recorded" },
            { label: "Forecaster trades", value: String(summary.trades), sub: abstained ? `${abstained} abstained` : round.payouts.some((item) => item.external) ? "incl. an outside wallet" : "recorded on-chain" },
          ];
        })()}
        summaryRows={[["Network", "Aurora testnet"], ["Stack", round.stack.label], ["Strategies", `${summary.strategies} + Hold`], ["Selected", summary.selectedName],
          ["Measured", <span key="m" className="num">{summary.measured ?? "—"}</span>], ["Recorded trades", <span key="t" className="num">{summary.trades}</span>], ["Saved", round.date ?? "—"]]}
        participants={participantViews(round)} facts={<RoundFacts round={round} />} />}
  </AppShell>;
}
