"use client";

import { ARBITRUM_SEPOLIA, AURORA_TESTNET, formatAge, formatUnits } from "@/lib/funding/model.mjs";
import type { FreshCheck, TidepoolDemo } from "@/lib/tidepool/model.mjs";
import { Address, CopyText, ExplorerLink, Icon } from "@/components/funding/primitives";
import { Badge, Button, DescriptionList, EvidenceBadge } from "@/components/ui";

const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";
const Tx = ({ chainId, hash }: { chainId: number; hash: string }) => <span className="tx-inline"><CopyText value={hash} label="transaction" /><ExplorerLink chainId={chainId} kind="tx" value={hash} enabled /></span>;

/** The completed transfer as the four funding steps. Every step is from saved evidence; the relayer status alone proves nothing. */
export function TidepoolFundingSteps({ demo }: { demo: TidepoolDemo }) {
  const steps = [
    { title: "Quote", detail: "Signed by Tidepool, verified offline. Pays the Safe directly." },
    { title: "Source deposit", detail: `${usdc(demo.funding.sourceAmount)} test USDC sent on Arbitrum Sepolia` },
    { title: "In transit", detail: "Tidepool relayer · final NEAR testnet settlement, checked on-chain" },
    { title: "Delivery verified", detail: `${usdc(demo.funding.deliveredAmount)} test USDC received by the Safe on Aurora testnet` },
  ];
  return <ol className="fund-steps" aria-label="Funding steps">
    {steps.map((step) => <li key={step.title} className="done"><span className="n" aria-hidden="true"><Icon name="check" /></span><b>{step.title}</b><span>{step.detail}</span></li>)}
  </ol>;
}

/** Re-reads the public receipts on demand. A failure or mismatch is shown as such; saved evidence is never relabelled fresh. */
export function FreshCheckRow({ fresh, freshing, onFresh, now }: { fresh: FreshCheck | null; freshing: boolean; onFresh: () => void; now: number }) {
  return <div className="stack" style={{ gap: 10 }}>
    <div className="fresh-row">
      <div className="chip-row"><EvidenceBadge kind="saved" /><span className="subtle" style={{ fontSize: 12.5 }}>Recorded when the transfer completed. Re-read the public receipts to check it now.</span></div>
      <Button size="sm" icon="refund" loading={freshing} onClick={onFresh}>Re-verify receipts now</Button>
    </div>
    {fresh ? (fresh.status === "verified"
      ? <p className="fresh-result ok"><EvidenceBadge kind="fresh" detail={now && fresh.observedAt ? formatAge(now - fresh.observedAt) : undefined} />Public receipts re-read: {usdc(fresh.deliveredAmount)} test USDC still matches the Safe delivery{fresh.providerStatus ? ` · provider status ${fresh.providerStatus}` : ""}.</p>
      : <p className="fresh-result"><Badge tone={fresh.status === "mismatch" ? "danger" : "neutral"}>{fresh.status === "mismatch" ? "Fresh read did not match" : "Fresh read unavailable"}</Badge><code>{fresh.code}</code> The saved evidence is unchanged and is not shown as freshly verified.</p>) : null}
  </div>;
}

/** Every identity and receipt behind the transfer, for the technical-details drawer. */
export function TidepoolEvidence({ demo }: { demo: TidepoolDemo }) {
  return <DescriptionList items={[
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
  ]} />;
}
