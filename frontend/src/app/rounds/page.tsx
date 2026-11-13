"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/funding/primitives";
import { EmptyState, Skeleton } from "@/components/ui";
import { Cap, PageHead } from "@/components/v2";
import { backendKind } from "@/lib/arena/capabilities.mjs";
import { useLocalState, useSavedRounds } from "@/lib/arena/hooks";
import { isLiveNow, liveRound } from "@/lib/arena/live.mjs";
import { localJourney, roundSummary, shortReturnX18 } from "@/lib/arena/model.mjs";
import "./round.css";

export default function RoundsPage() {
  const { rounds, error } = useSavedRounds();
  const local = useLocalState(8000);
  const journey = localJourney(local.data);
  const showLocal = backendKind(local.data, { loading: local.loading, error: local.error }) === "local";

  const live = isLiveNow(local.data) ? liveRound(local.data, Date.now()) : null;

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: "saved history" }}>
    <PageHead eyebrow="Rounds · saved testnet history" title="Rounds" line="Open a round to see its strategies, forecasts, execution and result."
      actions={live ? undefined : <Link className="link" href="/rounds/live">Live view<Icon name="arrow" /></Link>} />
    {live ? <Link className="rw-item" href="/rounds/live" style={{ marginBottom: 16 }}>
      <span className="rw-item-main"><b>Live now · Round {live.roundId} · Tidepool testnet stack</b><span className="muted">{live.phase}</span></span>
      <span className="rw-item-cap"><Cap tone="warn">Live</Cap></span><span className="rw-item-open">Watch<Icon name="arrow" /></span>
    </Link> : null}
    {!rounds && !error ? <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={72} />)}</div> : (
      <ul className="rw-list" aria-label="Rounds">
        {showLocal ? <li><Link className="rw-item" href="/rounds/local">
          <span className="rw-item-main"><b>Round {local.data?.roundId && local.data.roundId !== "0" ? local.data.roundId : "1"} · Local simulation</b><span className="muted">Disposable local chain · simulated prices</span></span>
          <span className="rw-item-cap"><Cap tone={journey.complete ? "ok" : journey.running ? "warn" : undefined}>{journey.complete ? "Settled" : journey.running ? "Running" : journey.halted ? "Halted" : "Not started"}</Cap></span>
          <span className="rw-item-col"><small>Selected</small><b>{journey.winnerId === null ? "—" : journey.isHold ? "Hold" : journey.proposals.find((item) => item.id === journey.winnerId)?.name ?? "—"}</b></span>
          <span className="rw-item-col"><small>Result</small><b className="num">{journey.evaluated ? shortReturnX18(journey.returnX18) ?? "—" : "—"}</b></span>
          <span className="rw-item-open">Open<Icon name="arrow" /></span>
        </Link></li> : null}
        {[...(rounds ?? [])].reverse().map((round) => {
          const summary = roundSummary(round);
          return <li key={round.slug}><Link className="rw-item" href={`/rounds/${round.slug}`}>
            <span className="rw-item-main"><b>Round {round.roundId} · {round.stack.label}</b><span className="muted">Aurora testnet{round.date ? ` · ${round.date}` : ""}</span></span>
            <span className="rw-item-cap"><Cap tone="ok" icon="check">Settled</Cap></span>
            <span className="rw-item-col"><small>Selected</small><b>{summary.selectedName}</b></span>
            <span className="rw-item-col"><small>Measured</small><b className="num">{summary.measured ?? "—"}</b></span>
            <span className="rw-item-open">Open<Icon name="arrow" /></span>
          </Link></li>;
        })}
        {error ? <li><EmptyState icon="alert" title="Saved rounds are unavailable">{error}</EmptyState></li> : null}
      </ul>
    )}
  </AppShell>;
}
