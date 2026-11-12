"use client";

import { ARBITRUM_SEPOLIA, AURORA_TESTNET, formatAge, formatUnits } from "@/lib/funding/model.mjs";
import { exactFactorX18, formatPoints, formatReturnX18, type TestnetRound } from "@/lib/record/model.mjs";
import type { FreshCheck, TidepoolDemo } from "@/lib/tidepool/model.mjs";
import { Address, CopyText, ExplorerLink, Icon } from "@/components/funding/primitives";
import { Badge, Button, DescriptionList, EvidenceBadge } from "@/components/ui";

const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";
const eth = (raw: string | null | undefined) => formatUnits(raw, 18, { maxFraction: 6 }) ?? "—";
const bpsPercent = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0")}` : ""}%`;
const Tx = ({ chainId, hash }: { chainId: number; hash: string }) => <span className="tx-inline"><CopyText value={hash} label="transaction" /><ExplorerLink chainId={chainId} kind="tx" value={hash} enabled /></span>;

/** Funding → decision → execution → outcome for the completed Tidepool demonstration, all from saved evidence. */
export function TidepoolStory({ demo, round }: { demo: TidepoolDemo; round: TestnetRound | null }) {
  const ret = round ? formatReturnX18(round.realisedReturnX18) : null;
  const redeemed = round ? round.payouts.filter((item) => item.payout !== null).length : 0;
  const steps = [
    { icon: "fund" as const, title: "Funding", body: `${usdc(demo.funding.sourceAmount)} test USDC on Arbitrum Sepolia → ${usdc(demo.funding.deliveredAmount)} delivered to the Aurora testnet Safe via Tidepool` },
    { icon: "users" as const, title: "Decision", body: round ? `${round.genuineModelCalls ?? "—"} genuine AI proposals → ${round.scriptedForecasters ?? "—"} scripted forecaster trades → ${round.winner.name} ${bpsPercent(round.winner.allocationBps)} test ETH selected` : "Round evidence unavailable" },
    { icon: "bolt" as const, title: "Execution", body: `The Safe swapped ${usdc(demo.swap.stableIn)} test USDC for ${eth(demo.swap.assetOut)} test ETH` },
    { icon: "pulse" as const, title: "Outcome", body: round ? `${ret ?? "—"} measured return · ${redeemed} forecasters redeemed · ${round.winner.name} ${round.reputation ? formatPoints(round.reputation.score) : "not recorded"} outcome point` : "Round evidence unavailable" },
  ];
  return <ol className="story" aria-label="Tidepool demonstration">
    {steps.map((step, index) => <li key={step.title}>
      <span className="story-index"><Icon name={step.icon} /></span>
      <div><span className="story-step">{index + 1}. {step.title}</span><p>{step.body}</p></div>
    </li>)}
  </ol>;
}

/** The completed transfer: source, relayer report, NEAR settlement, delivery and the optional fresh re-check. */
export function TidepoolFunding({ demo, fresh, freshing, onFresh, now }: { demo: TidepoolDemo; fresh: FreshCheck | null; freshing: boolean; onFresh: () => void; now: number }) {
  return <div className="stack">
    <DescriptionList items={[
      { label: "Source · Arbitrum Sepolia", value: <><b>{usdc(demo.funding.sourceAmount)} test USDC</b><Tx chainId={ARBITRUM_SEPOLIA} hash={demo.funding.sourceTransaction.hash} /></> },
      { label: "Signed quote", hint: "verified offline with Tidepool's quote-signing key", value: <><Badge tone="success"><Icon name="check" />Signature verified</Badge><CopyText value={demo.quote.signer} label="Tidepool quote-signing key" /></> },
      { label: "Recipient", hint: "the Safe directly · no virtualChainRecipient", value: <Address value={demo.quote.recipient} chainId={AURORA_TESTNET} label="recipient Safe" live /> },
      { label: "Relayer · Tidepool", hint: "community relayer, not official NEAR Intents", value: <><EvidenceBadge kind="provider" />{demo.provider.reportedStatus ?? <span className="unavailable">No status</span>}</> },
      { label: "Settlement · NEAR testnet", hint: `execute_intents at ${demo.nearSettlement.receiver} · final on-chain, verified separately`, value: <span className="tx-inline"><CopyText value={demo.nearSettlement.hash} label="NEAR transaction" />{demo.nearSettlement.url ? <a className="explorer-link" href={demo.nearSettlement.url} target="_blank" rel="noopener noreferrer" title="Open in NEAR testnet explorer"><Icon name="external" /><span className="sr-only">Open in explorer</span></a> : null}</span> },
      { label: "Delivered · Aurora testnet Safe", value: <><b>{usdc(demo.funding.deliveredAmount)} test USDC</b><Tx chainId={AURORA_TESTNET} hash={demo.funding.destinationTransaction.hash} /></> },
      { label: "Safe balance", value: `${usdc(demo.funding.safeBalance.before)} → ${usdc(demo.funding.safeBalance.after)} test USDC` },
      { label: "Bridge cost", hint: "relayer cost, not strategy performance", value: `${usdc(demo.funding.bridgeCost)} test USDC` },
      { label: "Trading Safe", value: <Address value={demo.contracts.safe} chainId={AURORA_TESTNET} label="Trading Safe" live /> },
      { label: "Token", value: <>{demo.token.label} <Address value={demo.token.address} chainId={AURORA_TESTNET} label="Tidepool test USDC" live /></> },
    ]} />
    <div className="fresh-row">
      <div><EvidenceBadge kind="saved" /> <span className="subtle">{demo.method ?? "Linked canonical receipts from trusted RPCs."}</span></div>
      <Button size="sm" icon="refund" loading={freshing} onClick={onFresh}>Re-verify receipts now</Button>
    </div>
    {fresh ? (fresh.status === "verified"
      ? <p className="fresh-result ok"><EvidenceBadge kind="fresh" detail={now && fresh.observedAt ? formatAge(now - fresh.observedAt) : undefined} />Public receipts re-read: {usdc(fresh.deliveredAmount)} test USDC still matches the Safe delivery{fresh.providerStatus ? ` · provider status ${fresh.providerStatus}` : ""}.</p>
      : <p className="fresh-result"><Badge tone={fresh.status === "mismatch" ? "danger" : "neutral"}>{fresh.status === "mismatch" ? "Fresh read did not match" : "Fresh read unavailable"}</Badge><code>{fresh.code}</code> The saved evidence above is unchanged; it is not shown as freshly verified.</p>) : null}
  </div>;
}

/** Separate buckets that must never be netted against each other. */
export function MoneyFlow({ demo, round }: { demo: TidepoolDemo | null; round: TestnetRound }) {
  const ret = formatReturnX18(round.realisedReturnX18);
  const factor = exactFactorX18(round.realisedReturnX18);
  const items = [
    ...(demo ? [
      { label: "Manager investment capital", hint: "delivered to the Safe", value: `${usdc(demo.funding.deliveredAmount)} test USDC` },
      { label: "Invested by the strategy", hint: "actual Safe swap", value: `${usdc(demo.swap.stableIn)} USDC → ${eth(demo.swap.assetOut)} ETH` },
    ] : []),
    { label: "Strategy performance", hint: factor ? `return factor ${factor}` : undefined, value: <b className={ret?.startsWith("−") ? "neg" : "pos"}>{ret ?? "Unavailable"}</b> },
    { label: "Forecast collateral", hint: "separate market escrow", value: `${usdc(round.totals.deposits)} test USDC deposited` },
    ...(round.collateral ? [{ label: "Market seed", hint: "sponsor seed, not manager capital", value: `${usdc(round.collateral.seed)} test USDC` }] : []),
    ...(demo ? [{ label: "Bridge cost", hint: "relayer cost, not strategy loss", value: `${usdc(demo.funding.bridgeCost)} test USDC` }] : []),
    { label: "Gas", hint: "testnet ETH paid per transaction", value: <span className="muted">Not counted above · see Transactions</span> },
  ];
  return <DescriptionList items={items} />;
}
