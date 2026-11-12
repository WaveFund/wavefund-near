"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AllocationRing, Chip, JourneyTrack } from "@/components/arena/parts";
import { Address, CopyText, Icon, identiconStyle } from "@/components/funding/primitives";
import { Notice, SegmentedControl, Skeleton } from "@/components/ui";
import { useLocalState, useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { localJourney, percentFromBps, savedJourney, shortReturnX18, type JourneyStage } from "@/lib/arena/model.mjs";
import { AURORA_TESTNET, formatUnits } from "@/lib/funding/model.mjs";
import { apiUrl } from "@/lib/state";
import type { TestnetRound } from "@/lib/record/model.mjs";

type SafeId = "tidepool" | "local" | "original";
type Inspection = { chainId: number; owners: string[]; threshold: number; moduleEnabled: boolean; maxSlippageBps: number; oracle: { usable: boolean }; activeRoundId: string; unsignedOnly: boolean };
const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";
const eth = (raw: string | null | undefined, max = 6) => formatUnits(raw, 18, { maxFraction: max }) ?? "—";

function useInspection(enabled: boolean) {
  const [data, setData] = useState<Inspection | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(apiUrl("/api/manager"), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15_000) }).then((response) => response.json()).then((body) => {
      if (active && body && body.chainId === 31337 && body.unsignedOnly === true && Array.isArray(body.owners) && Number.isInteger(body.threshold)) setData(body as Inspection);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [enabled]);
  return data;
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="card"><header className="card-header"><h2>{title}</h2>{action}</header><div className="card-body">{children}</div></section>;
}

function History({ rounds }: { rounds: TestnetRound[] }) {
  return <div className="table-wrap"><table className="table compact history">
    <thead><tr><th>Round</th><th>Selected</th><th>In the Safe</th><th className="num">Result</th><th>Saved</th></tr></thead>
    <tbody>{rounds.map((round) => {
      const spent = round.swap?.stableDelta?.startsWith("-") ? round.swap.stableDelta.slice(1) : null;
      return <tr key={round.slug}>
        <td><Link className="link" href={`/rounds/${round.slug}`}>Round {round.roundId}</Link></td>
        <td>{round.winner.isHold ? "Hold" : `${round.winner.name} · ${percentFromBps(round.winner.allocationBps)} ETH`}</td>
        <td className="muted">{round.winner.isHold ? "No swap" : spent && round.swap?.assetDelta ? `${formatUnits(spent, 6, { maxFraction: 2 })} USDC → ${eth(round.swap.assetDelta, 6)} ETH` : "Executed"}</td>
        <td className="num">{shortReturnX18(round.realisedReturnX18) ?? "—"}</td>
        <td className="muted">{round.date ?? "—"}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export default function SafePage() {
  const [safe, setSafe] = useState<SafeId>("tidepool");
  const { rounds } = useSavedRounds();
  const { demo } = useTidepoolDemo();
  const local = useLocalState(4000);
  const inspection = useInspection(safe === "local" && local.connected);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("safe");
    if (wanted === "local" || wanted === "original" || wanted === "tidepool") setSafe(wanted);
  }, []);
  function choose(next: SafeId) { setSafe(next); const url = new URL(window.location.href); url.searchParams.set("safe", next); window.history.replaceState(null, "", url); }

  const stackRounds = (id: "tidepool" | "original") => (rounds ?? []).filter((item) => item.stack.id === id);
  const latestSaved = safe === "local" ? null : stackRounds(safe).at(-1) ?? null;
  const journey = safe === "local" ? localJourney(local.data) : latestSaved ? savedJourney(latestSaved, demo) : null;
  const address = safe === "local" ? local.data?.safe.address ?? null : safe === "tidepool" ? demo?.contracts.safe ?? stackRounds("tidepool")[0]?.stack.safe ?? null : stackRounds("original")[0]?.stack.safe ?? null;
  const title = safe === "local" ? "Local simulation Safe" : safe === "tidepool" ? "Tidepool testnet Safe" : "Original testnet Safe";
  const network = safe === "local" ? "Anvil local · 31337" : `Aurora testnet · ${AURORA_TESTNET}`;
  const localTarget = safe === "local" && journey?.winnerId ? (local.data?.proposals.find((item) => String(item.id) === journey.winnerId)?.allocationBps ?? null) : null;

  let holdings: ReactNode = <Skeleton height={80} />;
  if (safe === "tidepool" && demo) {
    holdings = <div className="holdings">
      <AllocationRing bps={latestSaved?.winner.allocationBps ?? 0} size="lg" label={`Target after round ${latestSaved?.roundId ?? 1}: ${percentFromBps(latestSaved?.winner.allocationBps ?? 0)} test ETH`} />
      <div><div className="holding-rows">
        <div><span><i style={{ background: "var(--asset-cash)" }} />Test USDC</span><b>{demo.swap.stableAfter ? usdc(demo.swap.stableAfter) : "—"}</b></div>
        <div><span><i style={{ background: "var(--asset-risk)" }} />Test ETH</span><b>{eth(demo.swap.assetOut, 18)}</b></div>
      </div><p className="subtle" style={{ fontSize: 12.5, marginTop: 6 }}>Held after round {latestSaved?.roundId ?? 1}, from saved evidence. The ring shows the strategy&apos;s target weight; market moves change the actual weight.</p></div>
    </div>;
  } else if (safe === "local" && local.data) {
    holdings = <div className="holdings">
      <AllocationRing bps={localTarget ?? 0} size="lg" label={localTarget === null ? "All test USDC before the round" : `Target ${percentFromBps(localTarget)} test ETH`} />
      <div><div className="holding-rows">
        <div><span><i style={{ background: "var(--asset-cash)" }} />Test USDC</span><b>{usdc(local.data.safe.stableBalance)}</b></div>
        <div><span><i style={{ background: "var(--asset-risk)" }} />Test ETH</span><b>{eth(local.data.safe.assetBalance, 5)}</b></div>
        {local.data.safe.valueUsdX18 ? <div><span>Value at simulated prices</span><b>${formatUnits(local.data.safe.valueUsdX18, 18, { maxFraction: 2, minFraction: 2 })}</b></div> : null}
      </div><p className="subtle" style={{ fontSize: 12.5, marginTop: 6 }}>Live from the local chain. {localTarget === null ? "No strategy has executed yet." : "The ring shows the executed strategy's target weight."}</p></div>
    </div>;
  } else if (safe === "local" && !local.loading) {
    holdings = <p className="muted">The local demo is not running. Start it with <code>bash scripts/docker-demo/up.sh</code>.</p>;
  } else if (safe === "original" && rounds) {
    const r7 = stackRounds("original").find((item) => item.swap);
    holdings = <p className="muted">This Safe&apos;s balances are not part of the saved evidence. Its last recorded trade{r7?.swap?.stableDelta ? `, in round ${r7.roundId}, sold ${usdc(r7.swap.stableDelta.replace("-", ""))} test USDC for ${eth(r7.swap.assetDelta)} test ETH` : " is in the round history below"}.</p>;
  }

  const limits: Array<{ label: string; hint?: string; value: ReactNode }> = safe === "local"
    ? (inspection ? [
      { label: "Owners", hint: "who controls this Safe", value: `${inspection.threshold} of ${inspection.owners.length}` },
      { label: "Wavefund module", hint: "can execute only permitted actions", value: inspection.moduleEnabled ? <Chip tone="ok">Enabled</Chip> : <Chip tone="plain">Not enabled</Chip> },
      { label: "Max slippage per swap", value: percentFromBps(inspection.maxSlippageBps) ?? "—" },
      { label: "Price oracle", value: inspection.oracle.usable ? <Chip tone="ok">Usable</Chip> : <Chip tone="fixture">Not usable</Chip> },
      { label: "Ready for a round", hint: "from the local readiness checks", value: inspection.moduleEnabled && inspection.oracle.usable ? <Chip tone="ok" icon="check">Yes</Chip> : <Chip tone="plain">No</Chip> },
    ] : [{ label: "Checks", value: local.connected ? "Reading the local Safe…" : "Local demo offline" }])
    : safe === "tidepool" ? [
      { label: "Funding delivered", hint: "verified receipts, saved", value: demo ? <Chip tone="ok" icon="check">{usdc(demo.funding.deliveredAmount)} test USDC</Chip> : "—" },
      { label: "Used by a strategy round", hint: "same Safe and capital", value: latestSaved ? <Chip tone="ok" icon="check">Round {latestSaved.roundId} · settled</Chip> : "—" },
      { label: "Max slippage per swap", hint: "as executed", value: latestSaved?.swap?.slippageBps != null ? percentFromBps(latestSaved.swap.slippageBps) : "—" },
      { label: "Owners and module", value: <span className="muted">Not part of the saved evidence</span> },
    ] : [
      { label: "Max slippage per swap", hint: "as executed in round 7", value: stackRounds("original").find((item) => item.swap)?.swap?.slippageBps != null ? percentFromBps(stackRounds("original").find((item) => item.swap)!.swap!.slippageBps!) : "—" },
      { label: "Funding", value: <span className="muted">Before these rounds; not in the evidence</span> },
      { label: "Owners and module", value: <span className="muted">Not part of the saved evidence</span> },
    ];

  return <AppShell source={safe === "local" ? { label: "Local simulation", tone: "local", detail: local.connected ? "live" : "offline", status: local.connected ? "ok" : "off" } : { label: "Aurora testnet", tone: "testnet", detail: "saved evidence" }}>
    <header className="round-hero">
      <h1>My Safe</h1>
      <p className="lede">You control this Safe. Enabled modules can execute permitted actions, so review their authority. Strategies trade only what is inside it, within its limits.</p>
    </header>

    <div className="section-head">
      <SegmentedControl label="Configured Safe" value={safe} onChange={choose} options={[{ id: "tidepool", label: "Tidepool testnet" }, { id: "local", label: "Local simulation" }, { id: "original", label: "Original testnet" }]} />
      <span className="subtle" style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="lock" />Connecting your own Safe is not available yet. These are the configured demo Safes.</span>
    </div>

    <div className="safe-layout">
      <div className="stack">
        <section className="card"><div className="card-body">
          <div className="safe-id">
            <span className="safe-avatar" style={address ? identiconStyle(address) : { background: "var(--surface-3)" }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}><h2>{title}</h2><p>{network} · {address ? (safe === "local" ? <CopyText value={address} label="Safe address" /> : <Address value={address} chainId={AURORA_TESTNET} label="Safe address" live />) : "address unavailable"}</p></div>
          </div>
        </div></section>

        <Panel title="Investment capital" action={<Chip tone={safe === "local" ? "local" : "saved"}>{safe === "local" ? "Live · local" : "Saved evidence"}</Chip>}>
          {holdings}
          <p className="quiet-note" style={{ marginTop: 14 }}><Icon name="users" /><span>Forecast collateral is held by the market, not by this Safe, and never counts toward its capital. <Link className="link" href="/arena">How forecasting works</Link></span></p>
        </Panel>

        <Panel title={safe === "local" ? "Current round" : "Latest round"} action={journey ? <Link className="link" href={safe === "local" ? "/demo" : `/rounds/${latestSaved?.slug}`}>Open the round<Icon name="arrow" /></Link> : null}>
          {journey ? <JourneyTrack stages={journey.stages as JourneyStage[]} label="Latest round journey" /> : <Skeleton height={60} />}
        </Panel>

        {safe !== "local" ? <Panel title="Outcome history">{rounds ? <History rounds={stackRounds(safe)} /> : <Skeleton height={80} />}</Panel> : null}
      </div>

      <aside className="stack">
        <div className="fund-cta">
          <h3>Fund this Safe</h3>
          <p>{safe === "tidepool" ? "This Safe was funded through Tidepool: 200 test USDC sent from Arbitrum Sepolia, 199.48 delivered." : safe === "local" ? "The local deployment funds this Safe with test USDC." : "Funding for this Safe happened before the saved rounds."} Official NEAR Intents deposits can be previewed, not sent.</p>
          <Link className="btn btn-primary" href={safe === "tidepool" ? "/safe/fund?lane=tidepool" : "/safe/fund"}><Icon name="fund" />{safe === "tidepool" ? "See how it was funded" : "Preview funding"}</Link>
        </div>
        <Panel title="Limits and readiness">
          <ul className="limit-list">{limits.map((item) => <li key={item.label}><span>{item.label}{item.hint ? <small>{item.hint}</small> : null}</span><b>{item.value}</b></li>)}</ul>
          {safe === "local" ? <p className="subtle" style={{ fontSize: 12.5, marginTop: 12 }}>Owner changes are prepared as unsigned transactions in <Link className="link" href="/advanced">Advanced</Link>.</p> : null}
        </Panel>
        <Notice tone="neutral" icon="shield"><p>There is no in-app withdrawal. The owner keeps full Safe controls; withdrawals happen through the Safe itself.</p></Notice>
      </aside>
    </div>
  </AppShell>;
}
