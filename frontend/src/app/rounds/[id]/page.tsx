"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Address, Icon, useNow } from "@/components/funding/primitives";
import { EvidenceForecasters, EvidenceOutcome, EvidenceProposals, EvidenceTimeline, EvidenceTransactions } from "@/components/rounds/RoundEvidence";
import { TidepoolFunding, TidepoolStory } from "@/components/tidepool/TidepoolParts";
import { Badge, Card, CardHeader, DescriptionList, EmptyState, EvidenceBadge, Notice, PageHeader, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { AURORA_TESTNET } from "@/lib/funding/model.mjs";
import { loadRoundEvidence, loadTidepoolDemo, runTidepoolFreshCheck } from "@/lib/record/loader";
import { findRound, type TestnetRound } from "@/lib/record/model.mjs";
import type { FreshCheck, TidepoolDemo } from "@/lib/tidepool/model.mjs";

type DetailTab = "funding" | "proposals" | "forecasters" | "outcome" | "transactions";

export default function RoundDetailPage() {
  const now = useNow();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";
  const [rounds, setRounds] = useState<TestnetRound[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab | null>(null);
  const [demo, setDemo] = useState<TidepoolDemo | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshCheck | null>(null);
  const [freshing, setFreshing] = useState(false);

  useEffect(() => {
    let active = true;
    loadRoundEvidence().then((next) => { if (active) setRounds(next); }, (reason) => { if (active) setError(reason instanceof Error ? reason.message : "Round evidence is unavailable."); });
    return () => { active = false; };
  }, []);

  const { round, ambiguous } = findRound(rounds, id);
  const tidepool = round?.stack.id === "tidepool";
  useEffect(() => {
    if (!tidepool) return;
    let active = true;
    loadTidepoolDemo().then((next) => { if (active) setDemo(next); }, (reason) => { if (active) setDemoError(reason instanceof Error ? reason.message : "Tidepool funding evidence is unavailable."); });
    return () => { active = false; };
  }, [tidepool]);
  // A demo is only joined to the round it names (same engine and round id); anything else is ignored.
  const linkedDemo = demo && round && demo.strategy.roundSlug === round.slug ? demo : null;

  async function freshCheck() { setFreshing(true); try { setFresh(await runTidepoolFreshCheck()); } finally { setFreshing(false); } }

  const abstained = Boolean(round && round.forecasters.length && round.forecasters.every((item) => item.action === "abstain"));
  const scripted = round?.scriptedForecasters ?? 0;
  const active: DetailTab = tab ?? (tidepool ? "funding" : "proposals");
  const breadcrumb = <Link href="/" className="breadcrumb"><Icon name="chevron" />Rounds</Link>;

  return <AppShell network={{ label: "Aurora testnet", chainId: AURORA_TESTNET, tone: "testnet" }} status={{ label: round ? "Saved evidence" : error ? "Unavailable" : "Loading", tone: round ? "ok" : error ? "off" : "pending" }}>
    {!rounds && !error ? <><PageHeader breadcrumb={breadcrumb} title="Testnet round" description={<Skeleton width={320} />} /><Card><div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}</div></Card></>
      : error || !round ? <><PageHeader breadcrumb={breadcrumb} title="Testnet round" /><Card><EmptyState icon="alert" title={error ? "Round evidence unavailable" : ambiguous ? "That round number exists on more than one engine" : "No published evidence for this round"}>{error ?? (ambiguous ? "Open the round from the Rounds list; each round is identified by network, engine and round id." : "Only rounds with published, validated testnet evidence can be shown here.")}</EmptyState></Card></>
      : <>
        <PageHeader breadcrumb={breadcrumb} title={`Round ${round.roundId} · ${round.stack.label}`} description={round.title}
          meta={<><Badge tone="success" dot>Settled</Badge><EvidenceBadge kind="saved" detail={round.date ?? undefined} /><span>Aurora testnet · {AURORA_TESTNET}</span><span className="meta-engine">engine <Address value={round.stack.engine} chainId={AURORA_TESTNET} label="round engine" live /></span><span>· {round.genuineModelCalls ?? "—"} genuine AI calls</span>{scripted > 0 ? <Badge tone="warning">{scripted} scripted forecasters</Badge> : null}</>} />
        <div className="page-notice">
          {scripted > 0
            ? <Notice tone="warning" title="Hybrid test"><p>The proposals came from genuine AI calls, but the {scripted} forecasters were scripted test actors that placed actual testnet trades. Their trades exercise the market and payouts; they are not AI predictions.</p></Notice>
            : abstained
            ? <Notice title="No forecaster traded"><p>All four AI forecasters abstained because no forecast cleared the confidence and entry-cost checks. Hold won, nothing was swapped, and every forecaster redeemed their full deposit. No agent earned a point.</p></Notice>
            : null}
        </div>
        {tidepool ? (linkedDemo ? <TidepoolStory demo={linkedDemo} round={round} /> : demoError ? <div className="page-notice"><Notice tone="warning" title="Funding evidence unavailable"><p>{demoError}</p></Notice></div> : null) : null}
        <div className="detail-layout">
          <div className="card round-card">
            <Tabs idBase="evidence" label="Round evidence" value={active} onChange={setTab} tabs={[
              ...(tidepool ? [{ id: "funding" as const, label: "Funding" }] : []),
              { id: "proposals", label: "Proposals", count: round.proposals.length },
              { id: "forecasters", label: "Forecasters", count: round.forecasters.length },
              { id: "outcome", label: "Outcome" },
              { id: "transactions", label: "Transactions", count: round.transactions.length },
            ]} />
            <TabPanel idBase="evidence" tab={active}>
              {active === "funding" ? <div className="card-body">{linkedDemo ? <TidepoolFunding demo={linkedDemo} fresh={fresh} freshing={freshing} onFresh={() => void freshCheck()} now={now} />
                : demoError ? <EmptyState icon="alert" title="Funding evidence unavailable">{demoError}</EmptyState> : <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={36} />)}</div>}</div>
                : active === "proposals" ? <EvidenceProposals round={round} />
                : active === "forecasters" ? <EvidenceForecasters round={round} />
                : active === "outcome" ? <EvidenceOutcome round={round} demo={linkedDemo} />
                : <EvidenceTransactions round={round} />}
            </TabPanel>
          </div>
          <aside className="detail-side">
            <Card><CardHeader title="Milestones" icon="route" /><div className="card-body"><EvidenceTimeline round={round} demo={linkedDemo} /></div></Card>
            <Card><CardHeader title="Identity" icon="layers" /><div className="card-body"><DescriptionList items={[
              { label: "Network", value: `Aurora testnet · ${AURORA_TESTNET}` },
              { label: "Stack", value: round.stack.label },
              { label: "Engine", value: <Address value={round.stack.engine} chainId={AURORA_TESTNET} label="engine" live /> },
              { label: "Trading Safe", value: round.stack.safe ? <Address value={round.stack.safe} chainId={AURORA_TESTNET} label="Safe" live /> : "—" },
              { label: "Round", value: round.roundId },
              { label: "Model", value: round.model ?? "—" },
              { label: "TEE attestation", value: round.attestationVerified ? "Verified" : "Not verified" },
            ]} /></div></Card>
            <Card><CardHeader title="Limitations" icon="alert" />
              <div className="card-body"><ul className="bullets">{round.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
              {round.scope || round.correction ? <details className="disclosure"><summary>Scope and corrections</summary><div className="disclosure-body">{round.scope ? <p><b>Scope:</b> {round.scope}</p> : null}{round.correction ? <p><b>Correction:</b> {round.correction}</p> : null}</div></details> : null}
            </Card>
          </aside>
        </div>
      </>}
  </AppShell>;
}
