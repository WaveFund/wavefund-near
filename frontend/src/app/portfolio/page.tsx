"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import "./portfolio.css";
import { AppShell } from "@/components/AppShell";
import { Address, CopyText, Icon } from "@/components/funding/primitives";
import { TidepoolEvidence, TidepoolFundingSteps } from "@/components/tidepool/TidepoolParts";
import { Cap, DrawerButton, PageHead, Tip } from "@/components/v2";
import { Skeleton, TabPanel, Tabs } from "@/components/ui";
import { useLocalState, useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { backendKind } from "@/lib/arena/capabilities.mjs";
import { localJourney, percentFromBps, shortReturnX18 } from "@/lib/arena/model.mjs";
import { AURORA_TESTNET, formatUnits } from "@/lib/funding/model.mjs";
import { apiUrl } from "@/lib/state";
import {
  historyRows, holdingsFor, lastSwapRound, parseSafeParam, parseTabParam, permissionChecks, safeOptions, stackRounds,
  type Inspection, type SafeId, type TabId,
} from "@/lib/portfolio/view.mjs";

const usdc = (raw: string | null | undefined) => formatUnits(raw, 6, { maxFraction: 2 }) ?? "unavailable";
const TABS: Array<{ id: TabId; label: string }> = [{ id: "overview", label: "Overview" }, { id: "funding", label: "Funding" }, { id: "history", label: "History" }, { id: "permissions", label: "Permissions" }];
const TITLES: Record<SafeId, string> = { tidepool: "Tidepool testnet Safe", original: "Original testnet Safe", local: "Local simulation Safe" };

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

function setParam(key: string, value: string) {
  try { const url = new URL(window.location.href); url.searchParams.set(key, value); window.history.replaceState(null, "", url); } catch { /* the page still works without a persisted param */ }
}

export default function PortfolioPage() {
  const [rawSafe, setRawSafe] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const { rounds } = useSavedRounds();
  const { demo } = useTidepoolDemo();
  const local = useLocalState(4000);
  const kind = backendKind(local.data, { loading: local.loading, error: local.error });
  const localAllowed = kind === "local";
  const safe: SafeId = parseSafeParam(rawSafe, { localAllowed });
  const inspection = useInspection(safe === "local" && local.connected);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRawSafe(params.get("safe"));
    setTab(parseTabParam(params.get("tab")));
  }, []);
  function chooseSafe(next: SafeId) { setRawSafe(next); setParam("safe", next); }
  function chooseTab(next: TabId) { setTab(next); setParam("tab", next); }

  const saved = safe === "local" ? [] : stackRounds(rounds, safe);
  const latestSaved = saved.at(-1) ?? null;
  const swapRound = lastSwapRound(saved);
  const address = safe === "local" ? local.data?.safe.address ?? null : safe === "tidepool" ? demo?.contracts.safe ?? saved[0]?.stack.safe ?? null : saved[0]?.stack.safe ?? null;
  const holdings = holdingsFor({ safe, demo, latestSaved, local: safe === "local" ? local.data?.safe ?? null : null });
  const checks = permissionChecks({ safe, inspection, latestSaved, swapRound });
  const journey = safe === "local" && local.data ? localJourney(local.data) : null;

  const source = safe === "local"
    ? { label: "Local simulation", tone: "local" as const, detail: local.connected ? "live" : "offline", status: local.connected ? "ok" as const : "off" as const }
    : { label: "Aurora testnet", tone: "testnet" as const, detail: "saved evidence" };

  /* ---- Overview ---- */
  const holdingsCard = <section className="card pf-card" aria-label="Token holdings">
    <h2>Token holdings {holdings.caption ? <Cap>{holdings.caption}</Cap> : null}</h2>
    {holdings.status === "loading" ? <Skeleton height={80} />
      : holdings.status === "not-in-evidence" ? <p className="pf-empty">Balances for this Safe are not part of the saved evidence.</p>
      : holdings.status === "unavailable" ? <p className="pf-empty">The local simulation is not running, so no balances are shown.</p>
      : <>
        <div className="pf-holdings">{holdings.rows.map((item) => <div key={item.symbol} className="pf-holding"><span>{item.symbol}</span>{item.text ? <b className="num">{item.text}</b> : <b className="pf-na">unavailable</b>}</div>)}</div>
        {holdings.value ? <p className="pf-value">{holdings.value.text === "Value unavailable" ? <Cap>Value unavailable</Cap> : <><b className="num">{holdings.value.text}</b></>}{holdings.value.note ? <span>{holdings.value.note}</span> : null}</p> : null}
      </>}
    <p className="pf-note">Manager capital and forecasting collateral are separate<Tip label="About manager capital">Manager investment capital is separate from forecasting collateral; market seed backs the forecasting system.</Tip></p>
  </section>;

  let roundCard: ReactNode;
  if (safe === "local") {
    const winner = journey?.winnerId ? journey.proposals.find((item: { id: string }) => item.id === journey.winnerId) ?? null : null;
    roundCard = <section className="card pf-card" aria-label="Current round">
      <h2>Current round</h2>
      {local.data ? <>
        <div className="pf-round-head"><b>Round {local.data.roundId ?? "—"}</b>{journey?.running ? <Cap tone="warn">In progress</Cap> : null}</div>
        <div className="pf-facts">
          <div className="pf-fact"><span>Selected</span><b>{winner ? (journey?.isHold ? "Hold" : `${winner.name} · ${percentFromBps(winner.allocationBps)} ETH`) : "Not selected yet"}</b></div>
          <div className="pf-fact"><span>Measured result</span><b className="num">{shortReturnX18(journey?.returnX18) ?? "not measured yet"}</b></div>
        </div>
      </> : <p className="pf-empty">The local simulation is not running.</p>}
      <div className="pf-actions"><Link className="btn btn-primary" href="/rounds/local">Open round<Icon name="arrow" /></Link></div>
    </section>;
  } else if (!rounds) {
    roundCard = <section className="card pf-card"><h2>Latest round</h2><Skeleton height={80} /></section>;
  } else if (!latestSaved) {
    roundCard = <section className="card pf-card"><h2>Latest round</h2><p className="pf-empty">No saved round for this Safe.</p></section>;
  } else {
    const result = shortReturnX18(latestSaved.realisedReturnX18);
    roundCard = <section className="card pf-card" aria-label="Latest round">
      <h2>Latest round <Cap>saved evidence</Cap></h2>
      <div className="pf-round-head"><b>Round {latestSaved.roundId}</b><span className="pf-cap-line num">{latestSaved.date ?? ""}</span></div>
      <div className="pf-facts">
        <div className="pf-fact"><span>Selected allocation</span><b>{latestSaved.winner.isHold ? "Hold" : `${latestSaved.winner.name} · ${percentFromBps(latestSaved.winner.allocationBps)} ETH`}</b></div>
        <div className="pf-fact"><span>Measured result</span><b className="num">{result ?? "unavailable"}</b></div>
      </div>
      <div className="pf-actions">
        <Link className="btn btn-primary" href={`/rounds/${latestSaved.slug}`}>Open round<Icon name="arrow" /></Link>
        <button type="button" className="btn" onClick={() => chooseTab("funding")}><Icon name="fund" />Funding</button>
      </div>
    </section>;
  }

  /* ---- Funding ---- */
  const fundingBody = safe === "tidepool"
    ? (demo ? <section className="card pf-card" aria-label="Completed transfer">
      <h2>Completed transfer <Cap>saved evidence</Cap></h2>
      <p className="pf-route"><span>Arbitrum Sepolia</span><Icon name="arrow" /><span>Aurora testnet</span></p>
      <div className="pf-facts">
        <div className="pf-fact"><span>Sent</span><b className="num">{usdc(demo.funding.sourceAmount)} test USDC</b></div>
        <div className="pf-fact"><span>Received</span><b className="num">{usdc(demo.funding.deliveredAmount)} test USDC</b></div>
        <div className="pf-fact"><span>Bridge cost</span><b className="num">{usdc(demo.funding.bridgeCost)} test USDC</b></div>
      </div>
      <div className="pf-actions">
        <DrawerButton label="Receipts and steps" title="Completed transfer" icon="receipt"><div className="stack"><TidepoolFundingSteps demo={demo} /><TidepoolEvidence demo={demo} /></div></DrawerButton>
        <Link className="btn btn-sm" href={`/rounds/${demo.strategy.roundSlug}`}>Round it funded<Icon name="arrow" /></Link>
      </div>
    </section> : <section className="card pf-card"><h2>Completed transfer</h2><Skeleton height={90} /></section>)
    : safe === "original" ? <section className="card pf-card"><h2>Completed transfer</h2><p className="pf-empty">Funded before the saved rounds; not in the evidence.</p></section>
    : <section className="card pf-card"><h2>Completed transfer</h2><p className="pf-empty">The local simulation funds this Safe with test USDC at start-up. There is no transfer receipt.</p></section>;

  /* ---- History ---- */
  const hist = historyRows(saved);
  const historyBody = safe === "local" ? <section className="card pf-card"><h2>Rounds</h2><p className="pf-empty">The local simulation keeps no saved history. <Link className="link" href="/rounds/local">Open the live round</Link>.</p></section>
    : !rounds ? <section className="card pf-card"><h2>Rounds</h2><Skeleton height={90} /></section>
    : <section className="card pf-card" aria-label="Round history">
      <h2>Rounds <Cap>saved evidence</Cap></h2>
      {hist.length === 0 ? <p className="pf-empty">No saved rounds for this Safe.</p> : <div className="table-wrap"><table className="table compact">
        <thead><tr><th>Round</th><th>Selected</th><th>Swap</th><th className="num">Result</th><th>Saved</th></tr></thead>
        <tbody>{hist.map((item) => <tr key={item.slug}>
          <td><Link className="link" href={`/rounds/${item.slug}`}>{item.round}</Link></td>
          <td>{item.selected}</td><td className="muted num">{item.swap}</td><td className="num">{item.result}</td><td className="muted num">{item.saved}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>;

  /* ---- Permissions ---- */
  const permissionsBody = <section className="card pf-card" aria-label="Permissions and checks">
    <h2>Permissions {safe === "local" ? <Cap tone="ok">live · local</Cap> : <Cap>saved evidence</Cap>}</h2>
    {checks.length === 0 ? <p className="pf-empty">{local.connected ? "Reading the local Safe…" : "The local simulation is not running, so nothing can be checked."}</p>
      : <ul className="pf-checks">{checks.map((item) => <li key={item.label}><span>{item.label}</span>
        <b className={item.state === "unknown" ? "pf-unknown" : undefined}>{item.state === "ok" ? <Cap tone="ok" icon="check">{item.value}</Cap> : item.state === "warn" ? <Cap tone="warn" icon="alert">{item.value}</Cap> : item.value}</b></li>)}</ul>}
    <p className="pf-note"><Icon name="shield" />No in-app withdrawal; the owner withdraws through the Safe itself.</p>
    <div className="pf-actions"><Link className="btn btn-sm" href="/advanced"><Icon name="sliders" />Advanced owner tools</Link></div>
  </section>;

  return <AppShell source={source}>
    <PageHead eyebrow="Demo portfolio · Aurora testnet" title="Demo portfolio" line="You control the Safe. Selected strategies execute within its approved limits." />

    <div className="pf-controls">
      <label className="pf-select">Safe
        <select value={safe} onChange={(event) => chooseSafe(event.target.value as SafeId)} aria-label="Safe">
          {safeOptions({ localAllowed }).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <span className="pf-addr">{address ? (safe === "local" ? <CopyText value={address} label="Safe address" /> : <Address value={address} chainId={AURORA_TESTNET} label="Safe address" live />) : <span className="unavailable">address unavailable</span>}</span>
      <span className="pf-connect"><Cap icon="lock">Connect Safe · Not available</Cap><Tip label="About connecting a Safe">Connecting a Safe is not available yet. These are configured demo Safes.</Tip></span>
    </div>

    <div className="pf-tabs"><Tabs tabs={TABS} value={tab} onChange={chooseTab} label="Portfolio sections" idBase="pf" /></div>
    <TabPanel idBase="pf" tab={tab}>
      {tab === "overview" ? <div className="pf-grid">{holdingsCard}{roundCard}</div> : null}
      {tab === "funding" ? <div className="stack">
        {fundingBody}
        <section className="card pf-card pf-link-card" aria-label="Funding preview">
          <div><h3>Funding preview <Cap tone="warn">Sending disabled</Cap></h3><p>Official NEAR Intents mainnet dry quotes. Nothing can be sent.</p></div>
          <Link className="btn" href="/portfolio/fund"><Icon name="fund" />Open funding preview</Link>
        </section>
      </div> : null}
      {tab === "history" ? historyBody : null}
      {tab === "permissions" ? permissionsBody : null}
    </TabPanel>
  </AppShell>;
}
