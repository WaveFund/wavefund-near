"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { DemoState } from "@/lib/state";
import { describeSavedTx, percentFromBps, positionGroups, roundWindows, selectionSignals, type LocalJourney, type SavedJourney } from "@/lib/arena/model.mjs";
import { AURORA_TESTNET, formatUnits } from "@/lib/funding/model.mjs";
import { exactFactorX18, formatPoints, formatSignedUnits, type TestnetRound } from "@/lib/record/model.mjs";
import type { FreshCheck } from "@/lib/tidepool/model.mjs";
import { Address, CopyText, Icon } from "@/components/funding/primitives";
import { DescriptionList } from "@/components/ui";
import { FreshCheckRow, TidepoolEvidence, TidepoolFundingSteps } from "@/components/tidepool/TidepoolParts";
import { AgentAvatar, AllocationRing, Chip, PositionBoard, ResultPanel, SignalBoard, StageSection, StrategyCard, SwapVisual, TxList, type StrategyView, type TxItem } from "./parts";

const usdc = (raw: string | null | undefined, maxFraction?: number) => formatUnits(raw, 6, maxFraction === undefined ? undefined : { maxFraction }) ?? "—";
const eth = (raw: string | null | undefined, maxFraction?: number) => formatUnits(raw, 18, maxFraction === undefined ? undefined : { maxFraction }) ?? "—";
/** A 1e18-scaled share as a percentage with two decimals (truncated). */
function shareX18(raw: string | null | undefined): string | null {
  if (!raw || !/^\d+$/.test(raw) || BigInt(raw) > 10n ** 18n) return null;
  const hundredths = BigInt(raw) / 10n ** 14n;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}%`;
}
const complementX18 = (raw: string | null | undefined) => (raw && /^\d+$/.test(raw) && BigInt(raw) <= 10n ** 18n ? (10n ** 18n - BigInt(raw)).toString() : null);
const signTone = (text: string | null) => (text?.startsWith("−") ? "neg-quiet" : text?.startsWith("+") ? "pos-quiet" : "");

function Bucket({ icon, label, amount, unit, note, foot, primary = false }: { icon: "safe" | "users" | "layers"; label: string; amount: ReactNode; unit?: string; note: ReactNode; foot?: ReactNode; primary?: boolean }) {
  return <div className={`bucket ${primary ? "primary" : ""}`}>
    <span className="bucket-label"><Icon name={icon} />{label}</span>
    <span className="bucket-amount">{amount}{unit ? <span className="unit">{unit}</span> : null}</span>
    <span className="bucket-note">{note}</span>
    {foot ? <span className="bucket-foot">{foot}</span> : null}
  </div>;
}

function RedemptionTable({ rows, total }: { rows: Array<{ name: string; position: ReactNode; deposit: string | null; payout: string | null; profitLoss: string | null; scripted?: boolean }>; total?: { deposits: string | null; paid: string | null } }) {
  return <div className="table-wrap"><table className="table compact">
    <thead><tr><th>Forecaster</th><th>Position</th><th className="num">Deposited</th><th className="num">Redeemed</th><th className="num">Difference</th></tr></thead>
    <tbody>{rows.map((row) => {
      const diff = formatSignedUnits(row.profitLoss, 6);
      return <tr key={row.name}>
        <td><span className="who"><AgentAvatar name={row.name} kind="forecaster" size="sm" /><span>{row.name}</span>{row.scripted ? <Chip tone="fixture">Scripted</Chip> : null}</span></td>
        <td className="muted">{row.position}</td>
        <td className="num">{usdc(row.deposit)}</td>
        <td className="num">{usdc(row.payout)}</td>
        <td className={`num ${signTone(diff)}`}>{diff ?? "—"}</td>
      </tr>;
    })}
      {total && total.deposits && total.paid ? <tr className="total-row"><td colSpan={2}><b>All forecasters</b></td><td className="num"><b>{usdc(total.deposits)}</b></td><td className="num"><b>{usdc(total.paid)}</b></td><td /></tr> : null}
    </tbody>
  </table></div>;
}

// ================================================================ saved public round

const savedTx = (round: TestnetRound, list: TestnetRound["transactions"], prefix: string): TxItem[] =>
  list.map((item, index) => ({ key: `${prefix}-${index}`, text: describeSavedTx(item.label), hash: item.transactionHash, chainId: AURORA_TESTNET, href: item.url }));

export function SavedRoundStory({ round, journey, fresh, freshing, onFresh, now }: { round: TestnetRound; journey: SavedJourney; fresh: FreshCheck | null; freshing: boolean; onFresh: () => void; now: number }) {
  const demo = journey.linkedDemo;
  const stages = journey.stages;
  const challengers = round.proposals.filter((item) => item.id !== "0");
  const ai = (round.genuineModelCalls ?? 0) >= challengers.length;
  const strategies: StrategyView[] = round.proposals.map((item) => ({ id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: item.rationale, source: item.id === "0" ? "baseline" : ai ? "ai" : "fixture" }));
  const winner = strategies.find((item) => item.id === round.winner.id) ?? strategies[0];
  const positions = positionGroups(round.proposals, round.forecasters);
  const windows = roundWindows(round.market);
  const scripted = round.forecasters.filter((item) => item.scripted).length;
  const deposits = round.payouts.map((item) => item.deposit).filter((value): value is string => value !== null);
  const eachDeposit = deposits.length && deposits.every((value) => value === deposits[0]) ? usdc(deposits[0]) : null;
  const spent = round.swap?.stableDelta?.startsWith("-") ? round.swap.stableDelta.slice(1) : null;
  const received = round.swap?.assetDelta && !round.swap.assetDelta.startsWith("-") ? round.swap.assetDelta : null;
  const decision = new Map(round.forecasters.map((item) => [item.name, item]));
  const nameOf = (id: string | null) => (id === "0" ? "Hold" : strategies.find((item) => item.id === id)?.name ?? `#${id}`);
  const t = journey.transactions;

  return <div className="journey">
    <StageSection stage={stages[0]} index={0} techLabel="Funding evidence and setup transactions"
      tech={<>{demo ? <TidepoolEvidence demo={demo} /> : null}<div><p className="tech-group-title">Setup: test tokens, gas, registrations and approvals</p><TxList items={savedTx(round, t.setup, "setup")} /></div></>}>
      {demo ? <><TidepoolFundingSteps demo={demo} /><FreshCheckRow fresh={fresh} freshing={freshing} onFresh={onFresh} now={now} /></> : null}
      <div className="buckets">
        <Bucket primary icon="safe" label="Investment capital · the manager's Safe" amount={demo ? usdc(demo.funding.deliveredAmount) : "Funded earlier"} unit={demo ? "test USDC" : undefined}
          note={demo ? "Delivered before the round. Only the selected strategy can trade it, inside the Safe's limits." : "The Safe already held capital. Its funding is not part of this round's evidence."}
          foot={round.stack.safe ? <>Safe <Address value={round.stack.safe} chainId={AURORA_TESTNET} label="Safe" live /></> : null} />
        <Bucket icon="users" label="Forecast collateral · separate" amount={usdc(round.totals.deposits)} unit="test USDC"
          note={<>{round.payouts.length} forecasters&apos; own deposits{eachDeposit ? ` (${eachDeposit} each)` : ""}, held by the market. Never added to the Safe&apos;s budget.</>} />
        <Bucket icon="layers" label="Market seed · separate" amount={round.collateral ? usdc(round.collateral.seed) : "—"} unit={round.collateral ? "test USDC" : undefined}
          note="Liquidity that makes the forecasting markets tradable. Not manager capital." />
      </div>
      {demo ? <p className="quiet-note"><Icon name="receipt" /><span><b>{usdc(demo.funding.bridgeCost)} test USDC bridge cost.</b> A transfer cost between {usdc(demo.funding.sourceAmount)} sent and {usdc(demo.funding.deliveredAmount)} delivered. It is not part of strategy performance.</span></p> : null}
    </StageSection>

    <StageSection stage={stages[1]} index={1} tech={<TxList items={savedTx(round, t.proposals, "prop")} />} techLabel="Round opening and proposal transactions">
      <p>{ai ? `${challengers.length} AI agents each proposed a target allocation for the Safe` : `${challengers.length} agents proposed allocations`}, next to the Hold baseline that keeps today&apos;s allocation.</p>
      <div className="strategy-grid">{strategies.map((item) => <StrategyCard key={item.id} strategy={item} />)}</div>
      <p className="quiet-note"><Icon name="eye" /><span>A target such as 75% test ETH is a weight for the whole portfolio, not a share of a new deposit. Proposal bonds are refunded when the markets close.</span></p>
    </StageSection>

    <StageSection stage={stages[2]} index={2} tech={<TxList items={savedTx(round, t.forecasting, "fc")} />} techLabel="Deposit, credit and trade transactions">
      <p>Each forecaster deposited their own collateral. One deposit gives credits in every strategy&apos;s world (it is not split between them), and credits are traded for LONG or SHORT on the strategies they have a view on.</p>
      {scripted ? <p className="quiet-note"><Icon name="alert" /><span><b>{scripted} scripted forecasters.</b> These wallets were test actors placing real testnet trades to exercise the market and payouts. They are not AI predictions.</span></p> : null}
      {positions.positions ? <PositionBoard strategies={strategies} positions={positions} />
        : <ul className="tx-list">{positions.abstained.map((item) => <li key={item.name}><span className="who"><AgentAvatar name={item.name} kind="forecaster" size="sm" /><span><b>{item.name}</b> abstained</span></span><span className="muted" style={{ fontSize: 12.5 }}>{item.reason ?? "No reason recorded"}</span></li>)}</ul>}
    </StageSection>

    <StageSection stage={stages[3]} index={3} tech={<><TxList items={savedTx(round, t.selected, "sel")} />{round.market ? <DescriptionList items={[
      { label: "Final-window average (TWAP)", value: windows?.twap ?? "—" }, { label: "Qualifying margin over Hold", value: "0.5 points (contract constant)" }, { label: "Trading window", value: windows?.trading ?? "—" }]} /> : null}</>}
      techLabel="Selection transaction and rule">
      <div className="winner">
        <AllocationRing bps={winner.allocationBps} size="lg" />
        <div>
          <h4>{journey.isHold ? "Hold won. The allocation stays." : `${winner.name}'s ${percentFromBps(winner.allocationBps)} test ETH strategy`}</h4>
          <p>{journey.isHold
            ? "No challenger's final-window market average beat Hold's by more than 0.5 points, so the Safe keeps its token quantities. A valid outcome, not a failure."
            : `It had the highest market average over the final ${windows?.twap ?? "window"} of trading, and beat Hold's by more than the 0.5-point margin the contract requires.`}</p>
          <div className="chip-row"><Chip tone="plain" icon="clock">{windows?.twap ? `${windows.twap} final window` : "Final-window average"}</Chip><Chip tone="plain">Margin over Hold: 0.5 points</Chip></div>
        </div>
      </div>
      <p className="subtle" style={{ fontSize: 12.5 }}>The saved evidence records the winner, not each strategy&apos;s average, so per-strategy signals are not drawn for this round. Selection is not execution: that is the next step.</p>
    </StageSection>

    <StageSection stage={stages[4]} index={4} status={journey.isHold ? <Chip tone="plain">Skipped · Hold</Chip> : round.swap?.independentlyChecked ? <Chip tone="ok" icon="check">Independently checked</Chip> : null}
      tech={<TxList items={[...savedTx(round, t.executed, "ex"), ...(round.swap ? [{ key: "swap", text: "Investment swap", hash: round.swap.transactionHash, chainId: AURORA_TESTNET, href: round.swap.url }] : [])]} />} techLabel="Execution transactions">
      {journey.isHold ? <p>No swap. The Safe kept the token quantities it already held.</p>
        : spent && received ? <SwapVisual spent={{ label: "The Safe sold", amount: usdc(spent), symbol: "test USDC" }} received={{ label: "and received", amount: eth(received), symbol: "test ETH" }}
          note={<p className="quiet-note"><Icon name="safe" /><span>
            {demo && demo.swap.stableAfter ? <>The target is a weight for the whole Safe, so it moved {usdc(spent)} of its {usdc(demo.funding.deliveredAmount)} test USDC and kept {usdc(demo.swap.stableAfter)}. </> : <>The target is a weight for the whole Safe, so the trade size depends on what it already held. </>}
            {round.swap?.slippageBps !== null && round.swap?.slippageBps !== undefined ? <>The swap was limited to {percentFromBps(round.swap.slippageBps)} slippage.</> : null}</span></p>} />
        : <p className="muted">The execution is recorded, but its swap amounts are not part of the saved evidence.</p>}
    </StageSection>

    <StageSection stage={stages[5]} index={5} tech={<TxList items={savedTx(round, t.evaluated, "ev")} />} techLabel="Settlement transactions">
      <ResultPanel returnX18={round.realisedReturnX18} bounds={round.market?.returnBounds ?? null}
        caption={<>Measured {windows?.evaluation ? `over ${windows.evaluation} ` : ""}after trading closed, on test assets. Bridge cost and gas are not included.{journey.isHold ? " Hold is not scored for reputation." : ""}</>}>
        <div className="facts-row">
          <div className="fact"><span>Return factor</span><b>{exactFactorX18(round.realisedReturnX18) ?? "—"}</b></div>
          {journey.longPayoutX18 ? <div className="fact"><span>LONG claims settle at</span><b>{shareX18(journey.longPayoutX18)}</b><small>SHORT at {shareX18(complementX18(journey.longPayoutX18))}</small></div> : null}
        </div>
      </ResultPanel>
    </StageSection>

    <StageSection stage={stages[6]} index={6} tech={<TxList items={[...savedTx(round, t.redeemed, "rd"), ...(round.reputation ? [{ key: "rep", text: "Record the outcome point", hash: round.reputation.transactionHash, chainId: AURORA_TESTNET, href: round.reputation.url }] : [])]} />} techLabel="Redemption and reputation transactions">
      <p>Only the selected strategy&apos;s world pays out. Forecasters redeem their claims and unused credits in that world; positions in the other worlds pay nothing.</p>
      <RedemptionTable total={round.totals} rows={round.payouts.map((item) => {
        const f = decision.get(item.name);
        return { name: item.name, scripted: f?.scripted, deposit: item.deposit, payout: item.payout, profitLoss: item.profitLoss,
          position: f?.action === "buy" && f.side ? <><span className={`side-tag ${f.side}`}>{f.side.toUpperCase()}</span> {nameOf(f.proposalId)}</> : f?.action === "abstain" ? "Abstained" : "—" };
      })} />
      <div className="rep-update">
        <p>{round.reputation ? <><b>{round.winner.name} {formatPoints(round.reputation.score)} outcome point</b> recorded on the {round.stack.label.replace(/ testnet stack$/i, "")} stack, because its executed strategy lost value.</> : <><b>No outcome point.</b> {journey.isHold ? "Hold rounds are not scored." : "No reputation update is recorded for this round."}</>}</p>
        <Link className="link" href={`/agents?stack=${round.stack.id}`}>See agent records<Icon name="arrow" /></Link>
      </div>
    </StageSection>
  </div>;
}

/** Identity, provenance and limitations of a saved round: the deepest layer of detail. */
export function RoundFacts({ round }: { round: TestnetRound }) {
  const checks: Array<[string, boolean | null]> = [["Independent recomputation passed", round.checks.independentPassed], ["Recorded return matches the recomputation", round.checks.returnRecomputed],
    ["Payouts match the recomputation", round.checks.payoutsRecomputed], ["Safe balance changes match the swap", round.checks.swapChecked]];
  return <details className="tech card" style={{ borderTop: "1px solid var(--border)" }}>
    <summary><Icon name="chevron" />About this evidence: identity, checks and limitations</summary>
    <div className="tech-body">
      <DescriptionList items={[
        { label: "Network", value: `Aurora testnet · ${AURORA_TESTNET}` }, { label: "Stack", value: round.stack.label },
        { label: "Engine", value: <Address value={round.stack.engine} chainId={AURORA_TESTNET} label="engine" live /> },
        ...(round.stack.safe ? [{ label: "Trading Safe", value: <Address value={round.stack.safe} chainId={AURORA_TESTNET} label="Safe" live /> }] : []),
        ...(round.stack.reputation ? [{ label: "Reputation contract", value: <Address value={round.stack.reputation} chainId={AURORA_TESTNET} label="reputation contract" live /> }] : []),
        { label: "Round id", value: round.roundId }, { label: "Model", value: round.model ?? "—" }, { label: "Genuine model calls", value: round.genuineModelCalls ?? "—" },
        { label: "Hardware attestation", value: round.attestationVerified ? "Verified" : "Not verified" }, { label: "Saved", value: round.date ?? "—" },
      ]} />
      <ul className="check-list">{checks.filter(([, ok]) => ok !== null).map(([label, ok]) => <li key={label} className={ok ? "ok" : "no"}><Icon name={ok ? "check" : "cross"} /><div><b>{label}</b></div></li>)}</ul>
      {round.limitations.length ? <div><p className="tech-group-title">Limitations</p><ul className="plain-list">{round.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {round.scope ? <div><p className="tech-group-title">Scope</p><p className="muted" style={{ fontSize: 12.5 }}>{round.scope}</p></div> : null}
      {round.correction ? <div><p className="tech-group-title">Correction</p><p className="muted" style={{ fontSize: 12.5 }}>{round.correction}</p></div> : null}
    </div>
  </details>;
}

// ================================================================ local simulation

const localTx = (list: Array<{ label: string; hash: string }>, prefix: string): TxItem[] => list.map((item, index) => ({ key: `${prefix}-${index}`, text: item.label, hash: item.hash, chainId: null }));

export function LocalRoundStory({ state, journey }: { state: DemoState | null; journey: LocalJourney }) {
  const stages = journey.stages;
  const strategies: StrategyView[] = journey.proposals.map((item) => ({ id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: item.rationale, source: item.id === "0" ? "baseline" : "fixture" }));
  const winner = strategies.find((item) => item.id === journey.winnerId) ?? null;
  const signals = selectionSignals(journey.proposals);
  const participants = state?.forecast.participants ?? [];
  const decisions = new Map((state?.agents ?? []).filter((agent) => /forecast/i.test(agent.role)).map((agent) => [agent.name, agent]));
  const r = journey.receipts;
  const value = state?.safe.valueUsdX18 ? formatUnits(state.safe.valueUsdX18, 18, { maxFraction: 2, minFraction: 2 }) : null;
  const wait = "Starts when you run the simulation.";

  return <div className="journey">
    <StageSection stage={stages[0]} index={0} waiting="The local Safe has no test capital yet." tech={<TxList items={localTx(r.setup, "setup")} empty="Funded by the local deployment." />} techLabel="Setup">
      <div className="buckets">
        <Bucket primary icon="safe" label="Investment capital · local Safe" amount={value ? `$${value}` : usdc(state?.safe.stableBalance)} unit={value ? undefined : "USDC"}
          note={<>Now {usdc(state?.safe.stableBalance)} test USDC and {eth(state?.safe.assetBalance, 5)} test ETH, valued at simulated prices.</>}
          foot={state?.safe.address ? <>Safe <CopyText value={state.safe.address} label="local Safe" /></> : null} />
        <Bucket icon="users" label="Forecast collateral · separate" amount={usdc(state?.forecast.deposits)} unit="test USDC" note="Forecasters' own deposits this round, held by the market. Never added to the Safe's budget." />
        <Bucket icon="layers" label="Sponsor reserve · separate" amount={usdc(state?.sponsor.reserve)} unit="test USDC" note="Seeds the forecasting markets and funds rewards. Not manager capital." />
      </div>
    </StageSection>

    <StageSection stage={stages[1]} index={1} waiting={wait} tech={<TxList items={localTx(r.proposals, "prop")} />} techLabel="Round opening and proposal transactions">
      {strategies.length ? <><p>Simulated agents propose target allocations next to the Hold baseline. Their reasoning is scripted for this rehearsal.</p>
        <div className="strategy-grid">{strategies.map((item) => <StrategyCard key={item.id} strategy={item} />)}</div></>
        : <p className="muted">Waiting for the first proposals…</p>}
    </StageSection>

    <StageSection stage={stages[2]} index={2} waiting={wait} tech={<TxList items={localTx(r.forecasting, "fc")} />} techLabel="Deposit, credit and trade transactions">
      <p>Two simulated forecasters deposit their own collateral, receive credits in every strategy&apos;s world, and take opposing views.</p>
      <ul className="tx-list">{participants.map((item) => <li key={item.address}>
        <span className="who"><AgentAvatar name={item.name} kind="forecaster" size="sm" /><span><b>{item.name}</b> <span className="muted">{decisions.get(item.name)?.action ?? "No position yet"}</span></span></span>
        <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{item.deposit !== "0" ? `${usdc(item.deposit)} deposited` : "No deposit yet"}</span></li>)}</ul>
    </StageSection>

    <StageSection stage={stages[3]} index={3} waiting={wait} tech={<TxList items={localTx(r.selected, "sel")} />} techLabel="Selection transaction">
      {winner ? <div className="winner"><AllocationRing bps={winner.allocationBps} size="lg" /><div>
        <h4>{journey.isHold ? "Hold won. The allocation stays." : `${winner.name}'s ${percentFromBps(winner.allocationBps)} test ETH strategy`}</h4>
        <p>{journey.isHold ? "No challenger beat Hold's final-window average by more than 0.5 points." : "Highest final-window market average, and more than 0.5 points above Hold's, as the contract requires."}</p></div></div>
        : <p className="muted">Trading has closed. The final-window averages decide the winner.</p>}
      {signals ? <SignalBoard signals={signals} strategies={strategies} /> : null}
    </StageSection>

    <StageSection stage={stages[4]} index={4} waiting={wait} status={journey.isHold && journey.progress >= 5 ? <Chip tone="plain">Skipped · Hold</Chip> : null} tech={<TxList items={localTx(r.executed, "ex")} />} techLabel="Execution transactions">
      {journey.progress < 5 ? <p className="muted">The Safe module is executing the selected allocation…</p>
        : journey.isHold ? <p>No swap. The Safe kept its token quantities.</p>
        : <SwapVisual spent={{ label: "Target set by the winner", amount: winner ? `${percentFromBps(winner.allocationBps)}` : "—", symbol: "test ETH weight" }}
          received={{ label: "The Safe now holds", amount: `${eth(state?.safe.assetBalance, 5)} ETH`, symbol: `and ${usdc(state?.safe.stableBalance)} test USDC${value ? ` · ≈ $${value} at simulated prices` : ""}` }} />}
    </StageSection>

    <StageSection stage={stages[5]} index={5} waiting={wait} tech={<TxList items={localTx(r.evaluated, "ev")} />} techLabel="Settlement transactions">
      {journey.evaluated ? <ResultPanel returnX18={journey.returnX18} bounds={null} caption="Simulated prices on a local chain. A rehearsal of the mechanics, not investment performance.">
        {journey.longPayoutX18 ? <div className="facts-row"><div className="fact"><span>LONG claims settle at</span><b>{shareX18(journey.longPayoutX18)}</b><small>SHORT at {shareX18(complementX18(journey.longPayoutX18))}</small></div></div> : null}
      </ResultPanel> : <p className="muted">Recording holdings and measuring the return…</p>}
    </StageSection>

    <StageSection stage={stages[6]} index={6} waiting={wait} tech={<TxList items={localTx(r.redeemed, "rd")} />} techLabel="Redemption transactions">
      {journey.complete ? <><p>Forecasters redeem only their winning-world balances. The Safe&apos;s investment balances are never used for payouts.</p>
        <RedemptionTable rows={participants.map((item) => ({ name: item.name, deposit: item.deposit, payout: item.payout, profitLoss: item.profitLoss, position: decisions.get(item.name)?.action ?? "—" }))} /></>
        : <p className="muted">Redemptions open after settlement…</p>}
    </StageSection>
  </div>;
}
