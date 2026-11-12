"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/funding/primitives";
import { EvidenceForecasters, EvidenceOutcome, EvidenceProposals, EvidenceTimeline, EvidenceTransactions } from "@/components/rounds/RoundEvidence";
import { Badge, Card, CardHeader, DescriptionList, EmptyState, Notice, PageHeader, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { AURORA_TESTNET } from "@/lib/funding/model.mjs";
import { loadRoundEvidence } from "@/lib/record/loader";
import type { TestnetRound } from "@/lib/record/model.mjs";

type DetailTab = "proposals" | "forecasters" | "outcome" | "transactions";

export default function RoundDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const [rounds, setRounds] = useState<TestnetRound[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("proposals");

  useEffect(() => {
    let active = true;
    loadRoundEvidence().then((next) => { if (active) setRounds(next); }, (reason) => { if (active) setError(reason instanceof Error ? reason.message : "Round evidence is unavailable."); });
    return () => { active = false; };
  }, []);

  const round = rounds?.find((item) => item.roundId === id) ?? null;
  const abstained = Boolean(round && round.forecasters.length && round.forecasters.every((item) => item.action === "abstain"));
  const scripted = round?.scriptedForecasters ?? 0;
  const breadcrumb = <Link href="/" className="breadcrumb"><Icon name="chevron" />Rounds</Link>;

  return <AppShell network={{ label: "Aurora testnet", chainId: AURORA_TESTNET, tone: "testnet" }} status={{ label: round ? "Published evidence" : error ? "Unavailable" : "Loading", tone: round ? "ok" : error ? "off" : "pending" }}>
    {!rounds && !error ? <><PageHeader breadcrumb={breadcrumb} title={`Round ${id}`} description={<Skeleton width={320} />} /><Card><div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}</div></Card></>
      : error || !round ? <><PageHeader breadcrumb={breadcrumb} title={`Round ${id}`} /><Card><EmptyState icon="alert" title={error ? "Round evidence unavailable" : "No published evidence for this round"}>{error ?? "Only rounds with published, validated testnet evidence can be shown here."}</EmptyState></Card></>
      : <>
        <PageHeader breadcrumb={breadcrumb} title={`Round ${round.roundId}`} description={round.title}
          meta={<><Badge tone="success" dot>Settled</Badge><span>Aurora testnet · {AURORA_TESTNET}</span>{round.date ? <span>· {round.date}</span> : null}<span>· {round.genuineModelCalls ?? "—"} genuine AI calls</span>{scripted > 0 ? <Badge tone="warning">{scripted} scripted forecasters</Badge> : null}</>} />
        <div className="page-notice">
          {scripted > 0
            ? <Notice tone="warning" title="Hybrid test"><p>The proposals came from genuine AI calls, but the {scripted} forecasters were scripted to target one proposal. Their trades exercise the market and payouts; they are not AI predictions.</p></Notice>
            : abstained
            ? <Notice title="No forecaster traded"><p>All four AI forecasters abstained because no forecast cleared the confidence and entry-cost checks. Hold won, nothing was swapped, and every forecaster redeemed their full deposit. No agent earned a point.</p></Notice>
            : null}
        </div>
        <div className="detail-layout">
          <div className="card round-card">
            <Tabs idBase="evidence" label="Round evidence" value={tab} onChange={setTab} tabs={[
              { id: "proposals", label: "Proposals", count: round.proposals.length },
              { id: "forecasters", label: "Forecasters", count: round.forecasters.length },
              { id: "outcome", label: "Outcome" },
              { id: "transactions", label: "Transactions", count: round.transactions.length },
            ]} />
            <TabPanel idBase="evidence" tab={tab}>
              {tab === "proposals" ? <EvidenceProposals round={round} />
                : tab === "forecasters" ? <EvidenceForecasters round={round} />
                : tab === "outcome" ? <EvidenceOutcome round={round} />
                : <EvidenceTransactions round={round} />}
            </TabPanel>
          </div>
          <aside className="detail-side">
            <Card><CardHeader title="Milestones" icon="route" /><div className="card-body"><EvidenceTimeline round={round} /></div></Card>
            <Card><CardHeader title="Details" icon="layers" /><div className="card-body"><DescriptionList items={[
              { label: "Model", value: round.model ?? "—" },
              { label: "Genuine AI calls", value: round.genuineModelCalls ?? "—" },
              { label: "Scripted forecasters", value: scripted },
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
