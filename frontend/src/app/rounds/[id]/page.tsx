"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Chip, JourneyTrack, MiniTrack } from "@/components/arena/parts";
import { RoundFacts, SavedRoundStory } from "@/components/arena/story";
import { Icon, useNow } from "@/components/funding/primitives";
import { EmptyState, Skeleton } from "@/components/ui";
import { useFreshCheck, useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { savedJourney, shortReturnX18 } from "@/lib/arena/model.mjs";
import { findRound } from "@/lib/record/model.mjs";

export default function RoundPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";
  const now = useNow();
  const { rounds, error } = useSavedRounds();
  const { demo } = useTidepoolDemo();
  const fresh = useFreshCheck();
  const { round, ambiguous } = findRound(rounds, id);
  const journey = round ? savedJourney(round, demo) : null;
  const others = rounds?.filter((item) => item.slug !== round?.slug) ?? [];

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: "saved evidence" }}>
    <Link className="breadcrumb" href="/arena"><Icon name="chevron" />Arena</Link>
    {!rounds ? (error ? <EmptyState icon="alert" title="Saved rounds are unavailable">{error} Start the demo with <code>bash scripts/docker-demo/up.sh</code>.</EmptyState>
      : <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} />)}</div>)
    : !round || !journey ? <EmptyState icon="alert" title={ambiguous ? "Several rounds share that number" : "Round not found"}>
        {ambiguous ? "Round numbers repeat across engines. Pick the round by network, engine and round id:" : "No saved round matches this address."}
        <span className="chip-row" style={{ justifyContent: "center", marginTop: 12 }}>{rounds.map((item) => <Link key={item.slug} className="chip" href={`/rounds/${item.slug}`}>Round {item.roundId} · {item.stack.label}</Link>)}</span>
      </EmptyState>
    : <>
      <header className="round-hero">
        <div className="chip-row"><Chip tone="ok" icon="check">Settled</Chip><Chip tone="saved">Saved evidence{round.date ? ` · ${round.date}` : ""}</Chip><Chip tone="plain">Aurora testnet</Chip>
          {round.genuineModelCalls ? <Chip tone="ai" icon="spark">{round.genuineModelCalls} genuine AI calls</Chip> : null}
          {round.scriptedForecasters ? <Chip tone="fixture">{round.scriptedForecasters} scripted forecasters</Chip> : null}</div>
        <div>
          <h1>Round {round.roundId} · {round.stack.label}</h1>
          <p className="lede" style={{ marginTop: 6 }}>{round.title}. A completed round from public testnet evidence. Nothing here was re-run; the receipts can be re-checked.</p>
        </div>
      </header>

      <div className="track-card sticky">
        <div className="track-card-head"><h2>Round journey</h2><p>Select a step to jump to it</p></div>
        <JourneyTrack stages={journey.stages} />
      </div>

      <div style={{ marginTop: 16 }}>
        <SavedRoundStory round={round} journey={journey} fresh={fresh.fresh} freshing={fresh.freshing} onFresh={() => void fresh.run()} now={now} />
      </div>

      <div style={{ marginTop: 16 }}><RoundFacts round={round} /></div>

      {others.length ? <section className="block" aria-labelledby="other-rounds">
        <div className="section-head"><div><h2 id="other-rounds">Other saved rounds</h2><p>Each is identified by network, engine and round id; round numbers repeat across engines.</p></div></div>
        <div className="round-grid">{others.map((item) => {
          const other = savedJourney(item, demo);
          return <Link key={item.slug} className="round-card" href={`/rounds/${item.slug}`}>
            <div className="round-card-top"><div><h3>Round {item.roundId} · {item.stack.label}</h3><p className="ident">engine {item.stack.engine.slice(0, 6)}…{item.stack.engine.slice(-4)}</p></div><Chip tone="ok">Settled</Chip></div>
            <p>{item.title}</p>
            <MiniTrack stages={other.stages} />
            <div className="round-card-foot"><span className="muted" style={{ fontSize: 13 }}>{item.winner.isHold ? "Hold kept · no swap" : `${item.winner.name} selected`} · {shortReturnX18(item.realisedReturnX18) ?? "—"}</span><span className="path-cta">Open<Icon name="arrow" /></span></div>
          </Link>;
        })}</div>
      </section> : null}
    </>}
  </AppShell>;
}
