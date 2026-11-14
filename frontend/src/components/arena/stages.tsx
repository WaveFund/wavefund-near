"use client";

import { AiProvenance } from "./AiProvenance";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { DemoState } from "@/lib/state";
import {
  describeSavedTx, percentFromBps, positionGroups, roundWindows, selectionSignals, settlementShares,
  type LocalJourney, type PositionGroups, type SavedJourney, type SelectionSignals, type StageId, swapLeg } from "@/lib/arena/model.mjs";
import { AURORA_TESTNET, formatUnits } from "@/lib/funding/model.mjs";
import { exactFactorX18, formatPoints, formatSignedUnits, type TestnetRound } from "@/lib/record/model.mjs";
import { roundProvenance, TEE_LABELS } from "@/lib/record/provenance.mjs";
import type { FreshCheck, TidepoolDemo } from "@/lib/tidepool/model.mjs";
import { Address, CopyText, Icon } from "@/components/funding/primitives";
import { DescriptionList } from "@/components/ui";
import { Cap, Drawer, DrawerButton, Tip } from "@/components/v2";
import { FreshCheckRow, TidepoolEvidence, TidepoolFundingSteps } from "@/components/tidepool/TidepoolParts";
import { AgentAvatar, AllocationRing, PositionBoard, ResultPanel, SignalBoard, StrategyCard, SwapVisual, TxList, type StrategyView, type TxItem } from "./parts";

const usdc = (raw: string | null | undefined, maxFraction?: number) => formatUnits(raw, 6, maxFraction === undefined ? undefined : { maxFraction }) ?? "—";
const eth = (raw: string | null | undefined, maxFraction?: number) => formatUnits(raw, 18, maxFraction === undefined ? undefined : { maxFraction }) ?? "—";
const signTone = (text: string | null) => (text?.startsWith("−") ? "neg-quiet" : text?.startsWith("+") ? "pos-quiet" : "");

// ---------------------------------------------------------------- one normalised view of a round, saved or local

export type TxByStage = Record<"setup" | StageId, TxItem[]>;
export type StageCtx = {
  mode: "saved" | "local";
  journey: SavedJourney | LocalJourney;
  strategies: StrategyView[];
  winner: StrategyView | null;
  isHold: boolean;
  windows: ReturnType<typeof roundWindows>;
  signals: SelectionSignals | null;
  tx: TxByStage;
  saved: null | { round: TestnetRound; demo: TidepoolDemo | null; positions: PositionGroups; fresh: FreshCheck | null; freshing: boolean; onFresh: () => void; now: number };
  local: null | { state: DemoState | null };
};

const STAGE_KEYS: Array<"setup" | StageId> = ["setup", "funded", "proposals", "forecasting", "selected", "executed", "evaluated", "redeemed"];

export function savedCtx(round: TestnetRound, journey: SavedJourney, extra: { fresh: FreshCheck | null; freshing: boolean; onFresh: () => void; now: number }): StageCtx {
  // Every saved challenger shows its own provenance: model, provider and TEE status, or that it was scripted.
  const strategies: StrategyView[] = round.proposals.map((item) => ({ id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: item.rationale,
    source: item.id === "0" ? "baseline" : "agent", badge: item.id === "0" ? undefined : <AiProvenance round={round} agent={item} role="proposer" /> }));
  const tx = Object.fromEntries(STAGE_KEYS.map((key) => [key, journey.transactions[key].map((item, index) => ({ key: `${key}-${index}`, text: describeSavedTx(item.label), hash: item.transactionHash, chainId: AURORA_TESTNET, href: item.url }))])) as TxByStage;
  if (round.swap) tx.executed = [...tx.executed, { key: "swap", text: "Investment swap", hash: round.swap.transactionHash, chainId: AURORA_TESTNET, href: round.swap.url }];
  if (round.reputation) tx.redeemed = [...tx.redeemed, { key: "rep", text: "Record the outcome point", hash: round.reputation.transactionHash, chainId: AURORA_TESTNET, href: round.reputation.url }];
  return {
    mode: "saved", journey, strategies, winner: strategies.find((item) => item.id === round.winner.id) ?? strategies[0] ?? null, isHold: journey.isHold, windows: roundWindows(round.market),
    signals: selectionSignals(round.proposals), tx, saved: { round, demo: journey.linkedDemo, positions: positionGroups(round.proposals, round.forecasters), ...extra }, local: null,
  };
}

export function localCtx(state: DemoState | null, journey: LocalJourney): StageCtx {
  const strategies: StrategyView[] = journey.proposals.map((item) => ({ id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: item.rationale, source: item.id === "0" ? "baseline" : "fixture" }));
  const tx = Object.fromEntries(STAGE_KEYS.map((key) => [key, journey.receipts[key].map((item, index) => ({ key: `${key}-${index}`, text: item.label, hash: item.hash, chainId: null }))])) as TxByStage;
  return {
    mode: "local", journey, strategies, winner: strategies.find((item) => item.id === journey.winnerId) ?? null, isHold: journey.isHold, windows: null,
    signals: selectionSignals(journey.proposals), tx, saved: null, local: { state },
  };
}

// ---------------------------------------------------------------- small shared pieces

function Fact({ label, tip, value, unit }: { label: string; tip?: ReactNode; value: ReactNode; unit?: string }) {
  return <div className="rw-fact"><span>{label}{tip ? <> <Tip label={`About ${label.toLowerCase()}`}>{tip}</Tip></> : null}</span><b className="num">{value}</b>{unit ? <small>{unit}</small> : null}</div>;
}

function Receipts({ title, items, children }: { title: string; items: TxItem[]; children?: ReactNode }) {
  return <DrawerButton label="Receipts" title={title}>{children}<TxList items={items} /></DrawerButton>;
}

function RedemptionTable({ rows, total }: { rows: Array<{ name: string; scripted?: boolean; external?: boolean; deposit: string | null; payout: string | null; profitLoss: string | null }>; total?: { deposits: string | null; paid: string | null } }) {
  return <div className="table-wrap"><table className="table compact">
    <thead><tr><th>Participant</th><th className="num">Collateral</th><th className="num">Redeemed</th><th className="num">Net P/L</th></tr></thead>
    <tbody>{rows.map((row) => {
      const diff = formatSignedUnits(row.profitLoss, 6);
      return <tr key={row.name}>
        <td><span className="who"><AgentAvatar name={row.name} kind="forecaster" size="sm" /><span>{row.external ? "Outside wallet" : row.name}</span>{row.scripted ? <Cap>Scripted</Cap> : null}{row.external ? <Cap>Human · browser wallet</Cap> : null}</span></td>
        <td className="num">{usdc(row.deposit)}</td><td className="num">{usdc(row.payout)}</td><td className={`num ${signTone(diff)}`}>{diff ?? "—"}</td>
      </tr>;
    })}
      {total && total.deposits && total.paid ? <tr className="total-row"><td><b>All forecasters</b></td><td className="num"><b>{usdc(total.deposits)}</b></td><td className="num"><b>{usdc(total.paid)}</b></td><td /></tr> : null}
    </tbody>
  </table></div>;
}

const NOT_YET = "Not reached yet.";

// ---------------------------------------------------------------- stage renderers

export function FundedStage({ ctx }: { ctx: StageCtx }) {
  const { saved, local } = ctx;
  if (saved) {
    const { round, demo } = saved;
    return <div className="rw-stack">
      {demo ? <>
        <div className="rw-flow" aria-label={`${usdc(demo.funding.sourceAmount)} sent, ${usdc(demo.funding.deliveredAmount)} received`}>
          <div className="rw-end"><span className="rw-ico"><Icon name="wallet" /></span><small>Arbitrum Sepolia</small><b className="num">{usdc(demo.funding.sourceAmount)}</b><small>test USDC sent</small></div>
          <span className="rw-arrow" aria-hidden="true"><Icon name="arrow" /></span>
          <div className="rw-end to"><span className="rw-ico"><Icon name="safe" /></span><small>Aurora testnet Safe</small><b className="num">{usdc(demo.funding.deliveredAmount)}</b><small>test USDC received</small></div>
        </div>
        <div className="rw-row">
          <Cap tone="ok" icon="check">Saved · delivery verified</Cap>
          <span className="muted">Bridge cost <b className="num">{usdc(demo.funding.bridgeCost)}</b> test USDC <Tip label="About the bridge cost">A transfer cost between sent and delivered. It is not part of strategy performance.</Tip></span>
          <DrawerButton label="View transfer" title="Funding transfer" icon="route" className="btn btn-sm btn-primary">
            <TidepoolFundingSteps demo={demo} />
            <FreshCheckRow fresh={saved.fresh} freshing={saved.freshing} onFresh={saved.onFresh} now={saved.now} />
            <TidepoolEvidence demo={demo} />
          </DrawerButton>
        </div>
      </> : <div className="rw-row"><Cap icon="safe">Safe funded earlier</Cap><span className="muted">Its funding is not part of this round&apos;s evidence.</span></div>}
      <div className="rw-facts">
        <Fact label="Investment capital" tip="The manager's capital in the Safe. Only the selected strategy can trade it, inside the Safe's approved limits." value={demo ? usdc(demo.funding.deliveredAmount) : "Funded earlier"} unit={demo ? "test USDC" : undefined} />
        <Fact label="Forecast collateral" tip="Forecasters' own deposits, held by the market. Separate from the Safe's budget." value={usdc(round.totals.deposits)} unit="test USDC" />
        <Fact label="Market seed" tip="Liquidity that makes the forecasting markets tradable. Not manager capital." value={round.collateral ? usdc(round.collateral.seed) : "—"} unit={round.collateral ? "test USDC" : undefined} />
      </div>
    </div>;
  }
  const state = local?.state ?? null;
  const value = state?.safe.valueUsdX18 ? formatUnits(state.safe.valueUsdX18, 18, { maxFraction: 2, minFraction: 2 }) : null;
  return <div className="rw-stack">
    <div className="rw-facts">
      <Fact label="Investment capital" tip="The local Safe's test capital, valued at simulated prices." value={value ? `$${value}` : usdc(state?.safe.stableBalance)} unit={value ? "simulated" : "test USDC"} />
      <Fact label="Forecast collateral" tip="Forecasters' own deposits this round, held by the market. Separate from the Safe's budget." value={usdc(state?.forecast.deposits)} unit="test USDC" />
      <Fact label="Sponsor reserve" tip="Seeds the forecasting markets and funds rewards. Not manager capital." value={usdc(state?.sponsor.reserve)} unit="test USDC" />
    </div>
    {state?.safe.address ? <div className="rw-row"><span className="muted">Local Safe</span><CopyText value={state.safe.address} label="local Safe" /></div> : null}
  </div>;
}

export function ProposalsStage({ ctx }: { ctx: StageCtx }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!ctx.strategies.length) return <p className="muted">{ctx.mode === "local" ? "Waiting for the first proposals…" : "No proposals recorded."}</p>;
  const open = ctx.strategies.find((item) => item.id === openId) ?? null;
  const hold = open?.id === "0";
  return <>
    <div className="strategy-grid rw-cards">{ctx.strategies.map((item) => <StrategyCard key={item.id} strategy={item} compact onSelect={() => setOpenId(item.id)} />)}</div>
    <Drawer open={open !== null} onClose={() => setOpenId(null)} title={open ? (hold ? "Hold · keep allocation" : open.name) : ""}>
      {open ? <>
        <div className="rw-row"><AllocationRing bps={open.allocationBps} size="lg" /><div><b className="num">{percentFromBps(open.allocationBps)} test ETH</b><div className="muted">{hold ? "what the Safe holds now" : `${percentFromBps(10_000 - open.allocationBps)} test USDC`}</div></div></div>
        {open.source === "agent" ? (open.badge ? <div className="rw-row">{open.badge}</div> : null) : open.source === "fixture" ? <Cap>Simulated agent</Cap> : <Cap>Baseline</Cap>}
        <p>{hold ? "Keeps the Safe's current token quantities. A challenger must beat it to trade." : open.rationale.replace(/^SIMULATED AGENT:\s*/i, "") || "No rationale recorded."}</p>
        {!hold ? <p className="muted">A target is a weight for the whole portfolio, not a share of a new deposit.</p> : null}
      </> : null}
    </Drawer>
  </>;
}

export function ForecastingStage({ ctx }: { ctx: StageCtx }) {
  const { saved, local } = ctx;
  if (saved) {
    const { positions, round } = saved;
    return <div className="rw-stack">
      <div className="rw-row start">
        <span><b className="num">{round.forecasters.filter((item) => item.action === "buy").length}</b> recorded trades</span>
        {round.payouts.some((item) => item.external) ? <span className="subtle">+ {round.payouts.filter((item) => item.external).length} outside browser wallet (human) traded too · see Redeemed</span> : null}
        {ctx.signals ? null : <Cap title="The saved record keeps the winner, not each strategy's final-window average">Signal unavailable</Cap>}
        <Tip label="About credits">One deposit gives credits in every strategy&apos;s world, not split between them. Credits are traded for LONG or SHORT and are never summed across worlds.</Tip>
      </div>
      {positions.positions ? <PositionBoard strategies={ctx.strategies} positions={positions} /> : null}
      {positions.abstained.length ? <div className="rw-abstain"><span className="eyebrow">Abstained</span>
        {positions.abstained.map((item) => <span key={item.name} className="rw-pill" title={item.reason ?? "No reason recorded"}><AgentAvatar name={item.name} kind="forecaster" size="sm" />{item.name}</span>)}</div> : null}
      {round.forecasters.length ? <ul className="tx-list">{round.forecasters.map((item) => <li key={item.name}>
        <span className="who"><AgentAvatar name={item.name} kind="forecaster" size="sm" /><span className="aiprov-stack"><b>{item.name}</b><AiProvenance round={round} agent={item} role="forecaster" /></span></span>
        <span className="muted">{item.action === "buy" && item.side ? `${item.side.toUpperCase()} on #${item.proposalId}` : item.action === "abstain" ? "Abstained" : "Unknown"}</span></li>)}</ul> : null}
    </div>;
  }
  const participants = local?.state?.forecast.participants ?? [];
  const decisions = new Map((local?.state?.agents ?? []).filter((agent) => /forecast/i.test(agent.role)).map((agent) => [agent.name, agent]));
  if (!participants.length) return <p className="muted">No forecasters yet.</p>;
  return <ul className="tx-list">{participants.map((item) => <li key={item.address}>
    <span className="who"><AgentAvatar name={item.name} kind="forecaster" size="sm" /><span><b>{item.name}</b> <span className="muted">{decisions.get(item.name)?.action ?? "No position yet"}</span></span></span>
    <span className="muted num">{item.deposit !== "0" ? `${usdc(item.deposit)} deposited` : "No deposit yet"}</span></li>)}</ul>;
}

export function SelectedStage({ ctx }: { ctx: StageCtx }) {
  if (!ctx.winner) return <p className="muted">Selection pending.</p>;
  return <div className="rw-stack">
    <div className="rw-selected">
      <StrategyCard strategy={ctx.winner} selected compact />
      <div className="rw-row">
        {ctx.windows?.twap ? <Cap icon="clock">{ctx.windows.twap} final window</Cap> : null}
        <Cap>Required margin over Hold: &gt; 0.5 points</Cap>
        <span className="muted">Selection rule <Tip label="Selection rule">The challenger with the best final-window average (TWAP) is selected only if it is strictly above Hold&apos;s average plus 0.5 probability points. Otherwise Hold stays. It is not a count of LONG users.</Tip></span>
      </div>
    </div>
    {ctx.signals ? <>
      <p className="muted">Final-window market averages{ctx.mode === "saved" ? " recorded in the on-chain selection event" : ""}. {ctx.winner.name}: {ctx.signals.rows.find(r => r.id === ctx.winner?.id)?.percent?.toFixed(3)}%; Hold: {ctx.signals.holdPercent.toFixed(3)}%; qualifying line: {ctx.signals.thresholdPercent.toFixed(3)}%.</p>
      <SignalBoard signals={ctx.signals} strategies={ctx.strategies} />
    </> : <p className="muted">Final-window averages were not saved for this round.</p>}
  </div>;
}

export function ExecutedStage({ ctx }: { ctx: StageCtx }) {
  const { saved, local } = ctx;
  const summary = ctx.journey.stages[4].summary;
  const status = ctx.journey.stages[4].status;
  if (ctx.isHold) {
    return <div className="rw-hold">
      <AgentAvatar name="Hold" kind="hold" size="lg" />
      <div><b>{summary ?? "Hold"}</b><div className="muted">The Safe keeps its current token quantities.</div></div>
      {status === "done" ? <Cap tone="ok" icon="check">Hold applied</Cap> : <Cap tone="warn" icon="clock">Awaiting confirmation</Cap>}
    </div>;
  }
  if (saved) {
    const { round, demo } = saved;
    const leg = swapLeg(round.swap);
    if (!leg) return <p className="muted">Execution is recorded; its swap amounts are unavailable in the saved evidence.</p>;
    const show = (side: { raw: string; decimals: 6 | 18 }) => (side.decimals === 6 ? usdc(side.raw) : eth(side.raw, 6));
    return <div className="rw-stack">
      <SwapVisual spent={{ label: "The Safe sold", amount: show(leg.give), symbol: `test ${leg.give.symbol}` }} received={{ label: "and received", amount: show(leg.get), symbol: `test ${leg.get.symbol}` }} />
      <div className="rw-row">
        {round.swap?.independentlyChecked ? <Cap tone="ok" icon="check">Independently checked</Cap> : <Cap>Executed</Cap>}
        {demo?.swap.stableAfter ? <span className="muted">Safe kept <b className="num">{usdc(demo.swap.stableAfter)}</b> test USDC</span> : null}
        {round.swap?.slippageBps !== null && round.swap?.slippageBps !== undefined ? <span className="muted">Slippage limit <b className="num">{percentFromBps(round.swap.slippageBps)}</b></span> : null}
      </div>
    </div>;
  }
  const state = local?.state ?? null;
  if (ctx.journey.progress < 5) return <div className="rw-row"><Cap tone="warn" icon="clock">Executing</Cap></div>;
  const value = state?.safe.valueUsdX18 ? formatUnits(state.safe.valueUsdX18, 18, { maxFraction: 2, minFraction: 2 }) : null;
  return <SwapVisual spent={{ label: "Target set by the winner", amount: ctx.winner ? `${percentFromBps(ctx.winner.allocationBps)}` : "—", symbol: "test ETH weight" }}
    received={{ label: "The Safe now holds", amount: `${eth(state?.safe.assetBalance, 5)} ETH`, symbol: `and ${usdc(state?.safe.stableBalance)} test USDC${value ? ` · ≈ $${value} simulated` : ""}` }} />;
}

export function EvaluatedStage({ ctx }: { ctx: StageCtx }) {
  const journey = ctx.journey;
  if (!journey.evaluated || journey.returnX18 === null) return <div className="rw-row"><Cap tone={ctx.mode === "local" && journey.progress >= 5 ? "warn" : undefined}>{ctx.mode === "local" && journey.progress >= 5 ? "Measuring…" : "Not measured yet"}</Cap></div>;
  const shares = settlementShares(journey.longPayoutX18);
  const bounds = ctx.saved?.round.market?.returnBounds ?? null;
  const interval = ctx.windows?.evaluation;
  return <ResultPanel returnX18={journey.returnX18} bounds={bounds}
    caption={<>{interval ? <>Measured over <b className="num">{interval}</b> after trading closed</> : ctx.mode === "local" ? "Simulated prices on a local chain" : "Measured after trading closed"} · test assets
      {ctx.isHold ? <> <Tip label="Hold and reputation">Hold is not scored for reputation.</Tip></> : null}</>}>
    <div className="facts-row">
      <div className="fact"><span>Return factor</span><b>{exactFactorX18(journey.returnX18) ?? "—"}</b></div>
      {shares ? <div className="fact"><span>LONG settles at</span><b>{shares.long}</b><small>SHORT {shares.short}</small></div> : null}
    </div>
  </ResultPanel>;
}

export function RedeemedStage({ ctx }: { ctx: StageCtx }) {
  const { saved, local } = ctx;
  if (saved) {
    const { round } = saved;
    const scripted = new Map(round.forecasters.map((item) => [item.name, item.scripted]));
    return <div className="rw-stack">
      <RedemptionTable total={round.totals} rows={round.payouts.map((item) => ({ ...item, scripted: item.external ? false : scripted.get(item.name) }))} />
      <div className="rw-row">
        {round.reputation
          ? <span><span className="eyebrow">This round&apos;s outcome point</span> <b className="num">{formatPoints(round.reputation.score)}</b> <span className="muted">for {round.winner.name} on the {round.stack.label.replace(/ testnet stack$/i, "")} stack</span></span>
          : <span className="muted">{ctx.isHold ? "Hold rounds are not scored." : "No outcome point recorded for this round."}</span>}
        <Link className="link" href={`/agents?stack=${round.stack.id}`}>Agent records<Icon name="arrow" /></Link>
      </div>
    </div>;
  }
  if (!ctx.journey.complete) return <p className="muted">Redemptions open after settlement.</p>;
  const participants = local?.state?.forecast.participants ?? [];
  return <RedemptionTable rows={participants.map((item) => ({ name: item.name, deposit: item.deposit, payout: item.payout, profitLoss: item.profitLoss }))} />;
}

const RECAP_ICON: Record<StageId, "safe" | "spark" | "users" | "trophy" | "bolt" | "pulse" | "refund"> = { funded: "safe", proposals: "spark", forecasting: "users", selected: "trophy", executed: "bolt", evaluated: "pulse", redeemed: "refund" };

/** Compact recap for a finished round. Each step opens its stage; Replay journey walks them from Funded. */
export function ResultStage({ ctx, onReplay, onPick }: { ctx: StageCtx; onReplay: () => void; onPick: (stage: StageId) => void }) {
  const stages = ctx.journey.stages;
  const redeemed = ctx.saved ? (ctx.saved.round.totals.paid ? `${usdc(ctx.saved.round.totals.paid)} test USDC` : stages[6].summary) : stages[6].summary;
  const cells: Array<{ id: StageId; label: string; value: string | null }> = [
    { id: "funded", label: "Funded", value: stages[0].summary },
    { id: "selected", label: "Selected", value: stages[3].summary },
    { id: "executed", label: "Executed", value: stages[4].summary },
    { id: "evaluated", label: "Measured", value: stages[5].summary },
    { id: "redeemed", label: "Redeemed", value: redeemed },
  ];
  const round = ctx.saved?.round ?? null;
  return <div className="rw-stack">
    <ol className="rw-recap" aria-label="Round recap">
      {cells.map((cell) => <li key={cell.id}><button type="button" onClick={() => onPick(cell.id)}>
        <span className="rw-recap-ico" aria-hidden="true"><Icon name={RECAP_ICON[cell.id]} /></span>
        <span className="rw-recap-text"><span>{cell.label}</span><b className="num">{cell.value ?? "—"}</b></span>
        <Icon name="chevron" className="rw-recap-go" />
      </button></li>)}
    </ol>
    {ctx.signals ? <div className="rw-stack"><h3 className="rw-h3">How the market decided</h3><SignalBoard signals={ctx.signals} strategies={ctx.strategies} /></div> : null}
    <div className="rw-row between rw-result-foot">
      {round ? (round.reputation
        ? <span className="rw-rep"><span className="muted">Outcome point</span> <b className={`num ${signTone(formatPoints(round.reputation.score))}`}>{formatPoints(round.reputation.score)}</b> <span className="muted">for {round.winner.name}</span> <Link className="link" href={`/agents?stack=${round.stack.id}`}>Agent records<Icon name="arrow" /></Link></span>
        : <span className="muted">No outcome point this round{ctx.isHold ? " (Hold is not scored)" : ""}.</span>) : <span />}
      <button type="button" className="btn btn-primary" onClick={onReplay}><Icon name="play" />Replay step by step</button>
    </div>
  </div>;
}

// ---------------------------------------------------------------- selected-stage dispatch

const TITLES: Record<StageId, string> = { funded: "Funded", proposals: "Proposals", forecasting: "Forecasting", selected: "Selected", executed: "Executed", evaluated: "Measured", redeemed: "Redeemed" };

/** Renders exactly one stage body, with its receipts drawer. */
export function StageBody({ stage, ctx, onReplay, onPick }: { stage: StageId | "result"; ctx: StageCtx; onReplay: () => void; onPick: (stage: StageId) => void }) {
  if (stage === "result") return <ResultStage ctx={ctx} onReplay={onReplay} onPick={onPick} />;
  const info = ctx.journey.stages.find((item) => item.id === stage);
  if (info?.status === "upcoming" && ctx.mode === "local") return <p className="muted">{NOT_YET}</p>;
  const items = ctx.tx[stage];
  const body = { funded: <FundedStage ctx={ctx} />, proposals: <ProposalsStage ctx={ctx} />, forecasting: <ForecastingStage ctx={ctx} />, selected: <SelectedStage ctx={ctx} />,
    executed: <ExecutedStage ctx={ctx} />, evaluated: <EvaluatedStage ctx={ctx} />, redeemed: <RedeemedStage ctx={ctx} /> }[stage];
  return <>{body}{items.length || (stage === "funded" && ctx.tx.setup.length) ? <div className="rw-foot"><Receipts title={`${TITLES[stage]} · receipts`} items={stage === "funded" ? [...ctx.tx.setup, ...items] : items} /></div> : null}</>;
}

export { TITLES as STAGE_TITLES };

/** Identity, provenance and limitations of a saved round, for a drawer. */
export function RoundFacts({ round }: { round: TestnetRound }) {
  const prov = roundProvenance(round);
  const checks: Array<[string, boolean | null]> = [["Independent recomputation passed", round.checks.independentPassed], ["Recorded return matches the recomputation", round.checks.returnRecomputed],
    ["Payouts match the recomputation", round.checks.payoutsRecomputed], ["Safe balance changes match the swap", round.checks.swapChecked]];
  return <>
    <DescriptionList items={[
      { label: "Network", value: `Aurora testnet · ${AURORA_TESTNET}` }, { label: "Stack", value: round.stack.label },
      { label: "Engine", value: <Address value={round.stack.engine} chainId={AURORA_TESTNET} label="engine" live /> },
      ...(round.stack.safe ? [{ label: "Trading Safe", value: <Address value={round.stack.safe} chainId={AURORA_TESTNET} label="Safe" live /> }] : []),
      ...(round.stack.reputation ? [{ label: "Reputation contract", value: <Address value={round.stack.reputation} chainId={AURORA_TESTNET} label="reputation contract" live /> }] : []),
      { label: "Round id", value: round.roundId }, { label: prov.models.length > 1 ? `Models (${prov.models.length})` : "Model", value: prov.models.length ? <span className="mono">{prov.models.join(", ")}</span> : round.model ?? "—" }, { label: "Genuine model calls", value: round.genuineModelCalls ?? "—" },
      { label: "Hardware attestation", value: prov.tee === "verified" ? `TEE verified · ${prov.verified} of ${prov.challengers} proposals` : prov.tee === "partial" ? `${prov.verified} of ${prov.challengers} proposals TEE verified` : TEE_LABELS[prov.tee] }, { label: "Saved", value: round.date ?? "—" },
    ]} />
    <ul className="check-list">{checks.filter(([, ok]) => ok !== null).map(([label, ok]) => <li key={label} className={ok ? "ok" : "no"}><Icon name={ok ? "check" : "cross"} /><div><b>{label}</b></div></li>)}</ul>
    {round.limitations.length ? <div><p className="tech-group-title">Limitations</p><ul className="plain-list">{round.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {round.scope ? <div><p className="tech-group-title">Scope</p><p className="muted">{round.scope}</p></div> : null}
    {round.correction ? <div><p className="tech-group-title">Correction</p><p className="muted">{round.correction}</p></div> : null}
  </>;
}
