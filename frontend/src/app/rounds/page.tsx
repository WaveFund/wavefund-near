"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar } from "@/components/arena/identity";
import { Icon } from "@/components/funding/primitives";
import { EmptyState, SegmentedControl, Skeleton } from "@/components/ui";
import { Cap, PageHead } from "@/components/v2";
import { AllocationBar } from "@/components/viz";
import { backendKind } from "@/lib/arena/capabilities.mjs";
import { useLocalState, useSavedRounds } from "@/lib/arena/hooks";
import { isLiveNow, liveRound } from "@/lib/arena/live.mjs";
import { localJourney, roundSummary, shortReturnX18 } from "@/lib/arena/model.mjs";
import { roundProvenance } from "@/lib/record/provenance.mjs";

type Filter = "all" | "tidepool" | "original";
const signed = (text: string | null | undefined) => (text?.startsWith("−") ? "neg" : text?.startsWith("+") ? "pos" : "");

export default function RoundsPage() {
  const { rounds, error } = useSavedRounds();
  const local = useLocalState(8000);
  const journey = localJourney(local.data);
  const showLocal = backendKind(local.data, { loading: local.loading, error: local.error }) === "local";
  const live = isLiveNow(local.data) ? liveRound(local.data, Date.now()) : null;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => { const wanted = new URLSearchParams(window.location.search).get("stack"); if (wanted === "tidepool" || wanted === "original") setFilter(wanted); }, []);
  function choose(next: Filter) {
    setFilter(next);
    try { const url = new URL(window.location.href); if (next === "all") url.searchParams.delete("stack"); else url.searchParams.set("stack", next); window.history.replaceState(null, "", url); } catch { /* convenience only */ }
  }

  const all = useMemo(() => [...(rounds ?? [])].reverse(), [rounds]);
  const shown = all.filter((round) => (filter === "all" || round.stack.id === filter) && (!query.trim() || `round ${round.roundId} ${roundSummary(round).selectedName} ${round.stack.label}`.toLowerCase().includes(query.trim().toLowerCase())));
  const stats = useMemo(() => ({
    settled: all.length, challengers: all.filter((item) => !item.winner.isHold).length, swaps: all.filter((item) => item.swap).length,
    calls: all.reduce((sum, item) => sum + (item.genuineModelCalls ?? 0), 0),
  }), [all]);
  const counts = { all: all.length, tidepool: all.filter((item) => item.stack.id === "tidepool").length, original: all.filter((item) => item.stack.id === "original").length };
  const localWinner = journey.winnerId === null ? "—" : journey.isHold ? "Hold" : journey.proposals.find((item) => item.id === journey.winnerId)?.name ?? "—";

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: "saved history" }}>
    <PageHead eyebrow="Saved Aurora testnet history" title="Rounds" line="Every round from proposal to payout: the strategies, the forecasts, the selected allocation, the swap and the measured result."
      actions={!live ? <Link className="btn" href="/rounds/live"><Icon name="pulse" />Live view</Link> : undefined} />

    <div className="stats rounds-stats" aria-label="Round totals">
      {rounds ? <>
        <div className="stat"><div className="stat-label"><Icon name="layers" />Settled rounds</div><div className="stat-value">{stats.settled}</div><div className="stat-sub">{counts.tidepool} on Safe v2 · {counts.original} on Safe v1</div></div>
        <div className="stat"><div className="stat-label"><Icon name="trophy" />Challenger selected</div><div className="stat-value">{stats.challengers}<small>of {stats.settled}</small></div><div className="stat-sub">Hold kept in {stats.settled - stats.challengers}</div></div>
        <div className="stat"><div className="stat-label"><Icon name="bolt" />Safe swaps</div><div className="stat-value">{stats.swaps}</div><div className="stat-sub">through the approved router</div></div>
        <div className="stat"><div className="stat-label"><Icon name="spark" />Genuine AI calls</div><div className="stat-value">{stats.calls}</div><div className="stat-sub">NEAR AI Cloud models</div></div>
      </> : [0, 1, 2, 3].map((i) => <div className="stat" key={i}><Skeleton height={13} width="55%" /><div style={{ height: 10 }} /><Skeleton height={26} width="35%" /></div>)}
    </div>

    {live || showLocal ? <section className="now-list" aria-label="Running now">
      {live ? <Link className="now-item live" href="/rounds/live">
        <span className="now-pulse"><i className="pulse-dot" /></span>
        <span className="now-main"><b>Round {live.roundId} · Testnet Safe v2</b><span>{live.phase}</span></span>
        <Cap tone="bad">Live</Cap><span className="now-go">Watch<Icon name="arrow" /></span>
      </Link> : null}
      {showLocal ? <Link className="now-item" href="/rounds/local">
        <span className="now-pulse local"><Icon name="play" /></span>
        <span className="now-main"><b>Round {local.data?.roundId && local.data.roundId !== "0" ? local.data.roundId : "1"} · Local simulation</b><span>Disposable local chain · simulated prices · {localWinner === "—" ? "no selection yet" : `${localWinner} selected`}{journey.evaluated ? ` · ${shortReturnX18(journey.returnX18) ?? ""}` : ""}</span></span>
        <Cap tone={journey.complete ? "ok" : journey.running ? "warn" : undefined}>{journey.complete ? "Settled" : journey.running ? "Running" : journey.halted ? "Halted" : "Ready to run"}</Cap>
        <span className="now-go">Open<Icon name="arrow" /></span>
      </Link> : null}
    </section> : null}

    <div className="list-toolbar">
      <SegmentedControl label="Filter by Safe" value={filter} onChange={choose} options={[{ id: "all", label: `All · ${counts.all}` }, { id: "tidepool", label: `Safe v2 · ${counts.tidepool}` }, { id: "original", label: `Safe v1 · ${counts.original}` }]} />
      <label className="list-search"><Icon name="search" /><span className="sr-only">Search rounds</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search round or strategy" /></label>
    </div>

    {!rounds && !error ? <div className="card"><div className="stack" style={{ padding: 16 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={52} />)}</div></div>
      : error ? <div className="card"><EmptyState icon="alert" title="Saved rounds are unavailable">{error}</EmptyState></div>
      : <div className="card rounds-table" role="table" aria-label="Saved rounds">
        <div className="rx-head" role="row"><span role="columnheader">Round</span><span role="columnheader">Selected strategy</span><span role="columnheader">Evidence</span><span role="columnheader" className="r">Measured</span><span role="columnheader" aria-hidden="true" /></div>
        {shown.length === 0 ? <p className="rx-empty">No round matches “{query}”.</p> : shown.map((round) => {
          const summary = roundSummary(round); const prov = roundProvenance(round);
          return <Link key={round.slug} className="rx-row" role="row" href={`/rounds/${round.slug}`}>
            <span role="cell" className="rx-round"><span className="rx-num num">{round.roundId}</span><span><b>Round {round.roundId}</b><small>{round.stack.label} · {round.date ?? "—"}</small></span></span>
            <span role="cell" className="rx-sel"><AgentAvatar name={summary.selectedName} kind={summary.isHold ? "hold" : "proposer"} size="sm" />
              <span className="rx-sel-text"><b>{summary.selectedName}</b>{summary.isHold ? <small>kept the allocation</small> : <AllocationBar bps={round.winner.allocationBps} compact />}</span></span>
            <span role="cell" className="rx-tags">
              <Cap tone="ok" icon="check">Settled</Cap>
              {prov.tee === "verified" ? <Cap tone="ai" icon="shield">TEE verified</Cap> : round.genuineModelCalls ? <Cap icon="spark">{round.genuineModelCalls} AI calls</Cap> : null}
              {round.swap ? <Cap icon="bolt">Swap</Cap> : null}
              {round.limitations.some((item) => item.startsWith("Test-pool artifact")) ? <Cap tone="warn" icon="alert" title="Most of this return came from the private test pool, not a market move. See the round's evidence notes.">Test-pool artifact</Cap> : null}
            </span>
            <span role="cell" className={`rx-ret num ${signed(summary.measured)}`}>{summary.measured ?? "—"}</span>
            <span role="cell" className="rx-go" aria-hidden="true"><Icon name="chevron" /></span>
          </Link>;
        })}
      </div>}
    <p className="list-foot">Returns are measured on test assets over short testnet windows and are not a track record. A round marked “Test-pool artifact” explains its result in its evidence notes.</p>
  </AppShell>;
}
