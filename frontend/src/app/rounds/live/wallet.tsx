"use client";

// "Forecast from your wallet": the visitor's own injected wallet signs every step. Nothing here holds a key,
// and every number shown is read from Aurora testnet for the connected address.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, EIP1193Provider, Hash } from "viem";
import { CopyText, Icon } from "@/components/funding/primitives";
import { Button, Notice, SegmentedControl } from "@/components/ui";
import { Cap, Tip } from "@/components/v2";
import { explorerUrl, formatUnits, parseUnits } from "@/lib/funding/model.mjs";
import type { LiveRound } from "@/lib/arena/live.mjs";
import { accounts, chainIdOf, confirm, failureOf, injected, OUTCOME_DECIMALS, quote as readQuote, readPosition, send, STABLE_DECIMALS, switchToAurora, type Position, type TxRequest } from "@/lib/wallet/client";
import { AURORA_TESTNET_ID, DEFAULT_SLIPPAGE_BPS, explainError, isAuroraTestnet, minimumOut, nextTradeStep, redeemState, stepStates, windowFor, type NextStep } from "@/lib/wallet/flow.mjs";
import "./wallet.css";

const usdc = (v: bigint | null | undefined) => (typeof v === "bigint" ? formatUnits(v.toString(), STABLE_DECIMALS) ?? "unavailable" : "unavailable");
const outcome = (v: bigint | null | undefined) => (typeof v === "bigint" ? formatUnits(v.toString(), OUTCOME_DECIMALS, { maxFraction: 4 }) ?? "unavailable" : "unavailable");
const eth = (v: bigint | null | undefined) => (typeof v === "bigint" ? formatUnits(v.toString(), 18, { maxFraction: 5 }) ?? "unavailable" : "unavailable");
const creditsText = (v: bigint) => `${usdc(v)} ${v === 1_000_000n ? "credit" : "credits"}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const STEP_LABEL = { approve: "Approve test USDC", deposit: "Deposit", claim: "Claim credits", buy: "Buy" } as const;
const METAMASK = "https://metamask.io/download/";

type Tx = { label: string; phase: "signing" | "pending" | "confirmed" | "error"; hash?: Hash; message?: string };
type Side = "long" | "short";

function TxLine({ tx }: { tx: Tx | null }) {
  if (!tx) return null;
  const link = tx.hash ? explorerUrl(AURORA_TESTNET_ID, "tx", tx.hash) : null;
  const anchor = link ? <a href={link} target="_blank" rel="noreferrer" className="wf-link">View on explorer<Icon name="external" /></a> : null;
  if (tx.phase === "error") return <div className="wf-tx bad" role="alert"><Icon name="alert" /><span><b>{tx.label} failed.</b> {tx.message}</span>{anchor}</div>;
  if (tx.phase === "confirmed") return <div className="wf-tx ok" role="status"><Icon name="check" /><span><b>{tx.label} confirmed.</b></span>{anchor}</div>;
  return <div className="wf-tx warn" role="status"><span className="spinner" aria-hidden="true" /><span>{tx.phase === "signing" ? `${tx.label}: confirm in your wallet…` : `${tx.label}: waiting for the block…`}</span>{anchor}</div>;
}

function Stepper({ next, reads }: { next: NextStep; reads: Parameters<typeof stepStates>[1] }) {
  return <ol className="wf-steps" aria-label="Forecast steps">
    {stepStates(next, reads).map((s, i) => <li key={s.id} className={`wf-step ${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
      <span className="wf-num" aria-hidden="true">{s.state === "done" ? <Icon name="check" /> : i + 1}</span>
      <span>{STEP_LABEL[s.id]}</span><span className="sr-only">{`, ${s.state}`}</span>
    </li>)}
  </ol>;
}

export function WalletForecast({ view }: { view: LiveRound }) {
  const [provider, setProvider] = useState<EIP1193Provider | null | undefined>(undefined);
  const [account, setAccount] = useState<Address | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [tx, setTx] = useState<Tx | null>(null);
  const [depositText, setDepositText] = useState("10");
  const [creditText, setCreditText] = useState("1");
  const [proposalId, setProposalId] = useState<number>(1);
  const [side, setSide] = useState<Side>("long");
  const [quoted, setQuoted] = useState<{ key: string; value: bigint | null; error?: string } | null>(null);

  const onAurora = isAuroraTestnet(chain);
  const busy = tx?.phase === "signing" || tx?.phase === "pending";

  useEffect(() => {
    const p = injected(); setProvider(p);
    if (!p) return;
    void accounts(p, false).then((list) => setAccount(list[0] ?? null)).catch(() => setAccount(null));
    void chainIdOf(p).then(setChain).catch(() => setChain(null));
    const onAccounts = (list: unknown) => { setAccount(Array.isArray(list) && typeof list[0] === "string" ? (list[0] as Address) : null); setPos(null); };
    const onChain = (id: unknown) => setChain(typeof id === "string" ? id : null);
    p.on?.("accountsChanged", onAccounts); p.on?.("chainChanged", onChain);
    return () => { p.removeListener?.("accountsChanged", onAccounts); p.removeListener?.("chainChanged", onChain); };
  }, []);

  const refresh = useCallback(async () => {
    if (!account) return;
    try { setPos(await readPosition(account)); setReadError(null); } catch { setReadError("Could not read your position from Aurora testnet. Retrying."); }
  }, [account]);
  useEffect(() => { if (!account) return; void refresh(); const t = setInterval(() => void refresh(), 10_000); return () => clearInterval(t); }, [account, refresh]);

  const round = pos?.round ?? null;
  const win = round ? windowFor({ status: round.status, tradingEnd: round.tradingEnd, nowSec: round.nowSec }) : { kind: "none" as const, reason: "No round is open on the testnet." };
  const proposals = round ? Array.from({ length: round.proposalCount }, (_, id) => ({ id, name: id === 0 ? "Hold" : view.proposals.find((p) => p.id === String(id))?.name ?? `Strategy ${id}` })) : [];
  const chosen = pos?.proposals.find((p) => p.id === proposalId) ?? null;
  const depositAmount = (() => { const r = parseUnits(depositText, STABLE_DECIMALS); return r.ok ? BigInt(r.raw) : null; })();
  const creditAmount = (() => { const r = parseUnits(creditText, STABLE_DECIMALS); return r.ok ? BigInt(r.raw) : null; })();
  const reads = pos ? { balance: pos.balance, allowance: pos.allowance, deposit: pos.deposit, claimed: chosen?.claimed ?? null, credits: chosen?.credits ?? null } : null;
  const next = nextTradeStep({ reads, depositAmount, creditAmount });

  const quoteKey = round && creditAmount ? `${round.id}:${proposalId}:${side}:${creditAmount}` : null;
  const showQuote = win.kind === "open" && !!pos && pos.deposit > 0n;
  useEffect(() => {
    if (!showQuote || !quoteKey || !round || !creditAmount) return;
    let live = true;
    const t = setTimeout(() => {
      readQuote(round.id, proposalId, side, creditAmount)
        .then((value) => { if (live) setQuoted({ key: quoteKey, value }); })
        .catch((e) => { if (live) setQuoted({ key: quoteKey, value: null, error: explainError(failureOf(e)) }); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [showQuote, quoteKey, round, proposalId, side, creditAmount, pos]);
  const q = quoted && quoted.key === quoteKey ? quoted : null;
  const minOut = minimumOut(q?.value ?? null, DEFAULT_SLIPPAGE_BPS);

  async function run(label: string, req: TxRequest) {
    if (!provider || !account) return;
    setTx({ label, phase: "signing" });
    try {
      const hash = await send(provider, account, req);
      setTx({ label, phase: "pending", hash });
      await confirm(hash);
      setTx({ label, phase: "confirmed", hash });
    } catch (e) {
      setTx((prev) => ({ label, phase: "error", hash: prev?.hash, message: explainError(failureOf(e)) }));
    } finally { await refresh(); }
  }

  async function act() {
    if (!round || next.step === "blocked") return;
    if (next.step === "approve") return run(`Approve ${usdc(next.amount)} test USDC`, { kind: "approve", amount: next.amount });
    if (next.step === "deposit") return run(`Deposit ${usdc(next.amount)} test USDC`, { kind: "deposit", roundId: round.id, amount: next.amount });
    if (next.step === "claim") return run(`Claim ${creditsText(next.amount)}`, { kind: "claim", roundId: round.id, proposalId, amount: next.amount });
    if (!minOut || !q?.value) return;
    try {
      const fresh = await readQuote(round.id, proposalId, side, next.amount);
      if (fresh < minOut) { setQuoted({ key: quoteKey ?? "", value: fresh }); setTx({ label: "Buy", phase: "error", message: "The price moved below your minimum. Review the new quote." }); return; }
    } catch (e) { setTx({ label: "Buy", phase: "error", message: explainError(failureOf(e)) }); return; }
    return run(`Buy ${side.toUpperCase()}`, { kind: "buy", roundId: round.id, proposalId, side, amount: next.amount, minOut });
  }

  async function connect() {
    if (!provider) return;
    try { const list = await accounts(provider, true); setAccount(list[0] ?? null); setChain(await chainIdOf(provider)); setTx(null); }
    catch (e) { setTx({ label: "Connect", phase: "error", message: explainError(failureOf(e)) }); }
  }
  async function switchNetwork() {
    if (!provider) return;
    try { await switchToAurora(provider); setChain(await chainIdOf(provider)); setTx(null); }
    catch (e) { setTx({ label: "Switch network", phase: "error", message: explainError(failureOf(e)) }); }
  }

  const redeem = useMemo(() => {
    if (!pos || !round) return null;
    const w = pos.proposals.find((p) => p.id === round.winnerId);
    const holdings = w ? w.credits + w.long + w.short : 0n;
    return redeemState({ windowKind: win.kind, deposit: pos.deposit, redeemed: pos.redeemed, winnerHoldings: holdings, preview: pos.preview });
  }, [pos, round, win.kind]);

  const held = pos?.proposals.filter((p) => p.claimed > 0n || p.credits > 0n || p.long > 0n || p.short > 0n) ?? [];
  const head = <header className="rw-panel-head wf-head">
    <h2 id="wf-title"><Icon name="wallet" />Your wallet</h2>
    {account ? <span className="wf-acct"><i className={`wf-net ${onAurora ? "ok" : "bad"}`} aria-hidden="true" /><span className="num">{short(account)}</span></span> : <Cap>Test assets</Cap>}
  </header>;
  const foot = <p className="wf-foot">Test assets on Aurora testnet · your wallet signs every transaction · not financial advice</p>;

  let body;
  if (provider === undefined) body = <p className="muted">Looking for a browser wallet…</p>;
  else if (provider === null) body = <Notice tone="neutral" icon="wallet" title="No browser wallet found"><p>To forecast with your own test USDC, install a wallet such as <a className="wf-link" href={METAMASK} target="_blank" rel="noreferrer">MetaMask<Icon name="external" /></a>, then reload this page.</p></Notice>;
  else if (!account) body = <div className="wf-stack"><p className="muted">Connect a wallet to take a forecasting position in this round with your own test USDC.</p>
    <div><Button variant="primary" icon="wallet" onClick={() => void connect()}>Connect wallet</Button></div></div>;
  else if (!onAurora) body = <div className="wf-stack"><Notice tone="warning" title="Wrong network"><p>Your wallet is on another network. Forecasting runs on Aurora testnet.</p></Notice>
    <div><Button variant="primary" icon="aurora" onClick={() => void switchNetwork()}>Switch to Aurora testnet</Button></div></div>;
  else if (!pos) body = <p className="muted">{readError ?? "Reading your position from Aurora testnet…"}</p>;
  else {
    const roundNote = round && String(round.id) !== view.roundId ? <p className="muted wf-small">The chain reports round {String(round.id)}; this page shows round {view.roundId}. Your position uses the chain&apos;s current round.</p> : null;
    const needsUsdc = win.kind === "open" && pos.deposit === 0n && pos.balance === 0n;
    body = <div className="wf-stack">
      <div className="rw-facts wf-facts">
        <div className="rw-fact"><span>Test USDC</span><b className="num">{usdc(pos.balance)}</b><small>in your wallet</small></div>
        <div className="rw-fact"><span>Your deposit</span><b className="num">{usdc(pos.deposit)}</b><small>{round ? `round ${round.id}` : "no round"}</small></div>
        <div className="rw-fact"><span>Gas</span><b className="num">{eth(pos.gas)}</b><small>test ETH</small></div>
      </div>
      {roundNote}
      {readError ? <p className="muted wf-small">{readError}</p> : null}
      {win.kind !== "open" && win.kind !== "redeem" ? <div className="rw-row start"><Cap tone="warn" icon="clock">{win.kind === "none" ? "No open round" : win.kind === "closing" ? "Closing" : "Trading closed"}</Cap><span className="muted">{win.reason}</span></div> : null}

      {needsUsdc ? <Notice tone="neutral" icon="fund" title="Ask the operator for test USDC"><p>This wallet holds no test USDC. Send the operator your address:</p><p className="wf-copy"><CopyText value={account} label="your address" /></p></Notice> : null}

      {win.kind === "open" && !needsUsdc ? <div className="wf-stack">
        <Stepper next={next} reads={reads} />
        {pos.deposit === 0n ? <label className="field wf-field">Deposit<small>test USDC, held by the round until you redeem</small>
          <input className="input num" inputMode="decimal" value={depositText} onChange={(e) => setDepositText(e.target.value)} aria-invalid={depositAmount === null} disabled={busy} /></label>
          : <div className="wf-grid">
            <label className="field">Strategy<select className="rw-select" value={proposalId} onChange={(e) => setProposalId(Number(e.target.value))} disabled={busy}>
              {proposals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <div className="field">Side <SegmentedControl label="Side" value={side} onChange={setSide} options={[{ id: "long", label: "LONG" }, { id: "short", label: "SHORT" }]} /></div>
            <label className="field">Credits<small>1 credit = 1 test USDC of your deposit</small>
              <input className="input num" inputMode="decimal" value={creditText} onChange={(e) => setCreditText(e.target.value)} aria-invalid={creditAmount === null} disabled={busy} /></label>
            <div className="wf-quote" aria-live="polite">
              <span className="muted">You&apos;d receive <Tip label="About the quote">Read from the market contract now (quoteBuy{side === "long" ? "Long" : "Short"}). The buy is sent with a minimum 0.5% below it and reverts if the price moves further.</Tip></span>
              <b className="num">{q ? (q.value !== null ? `${outcome(q.value)} ${side.toUpperCase()}` : "unavailable") : "…"}</b>
              <small className="muted">{q?.error ?? (minOut !== null ? `minimum ${outcome(minOut)} after 0.5% slippage` : " ")}</small>
            </div>
          </div>}
        {next.step === "blocked" ? <p className="muted wf-small">{next.message}</p> : null}
        <div><Button variant="primary" loading={busy} disabled={busy || next.step === "blocked" || (next.step === "buy" && minOut === null)} onClick={() => void act()}>
          {next.step === "approve" ? `Approve ${usdc(next.amount)} test USDC` : next.step === "deposit" ? `Deposit ${usdc(next.amount)} test USDC`
            : next.step === "claim" ? `Claim ${creditsText(next.amount)} on ${proposals.find((p) => p.id === proposalId)?.name ?? "strategy"}` : next.step === "buy" ? `Buy ${side.toUpperCase()} with ${creditsText(next.amount)}` : "Continue"}
        </Button></div>
      </div> : null}

      {win.kind === "redeem" && redeem ? <div className="wf-stack">
        <div className="rw-row start"><Cap tone="ok" icon="check">{win.reason}</Cap></div>
        {redeem.canRedeem ? <><div className="wf-quote"><span className="muted">Redeem pays</span><b className="num">{usdc(pos.preview)} test USDC</b><small className="muted">previewRedeem, read now</small></div>
          <div><Button variant="primary" loading={busy} disabled={busy} onClick={() => round && void run("Redeem", { kind: "redeem", roundId: round.id })}>Redeem {usdc(pos.preview)} test USDC</Button></div></>
          : <p className="muted">{redeem.message}</p>}
      </div> : null}

      <TxLine tx={tx} />

      {held.length ? <div className="table-wrap"><table className="table wf-table"><caption className="sr-only">Your position this round</caption>
        <thead><tr><th>Strategy</th><th>Claimed</th><th>Credits</th><th>LONG</th><th>SHORT</th></tr></thead>
        <tbody>{held.map((p) => <tr key={p.id}><td>{proposals.find((x) => x.id === p.id)?.name ?? `Strategy ${p.id}`}</td><td className="num">{usdc(p.claimed)}</td><td className="num">{usdc(p.credits)}</td><td className="num">{outcome(p.long)}</td><td className="num">{outcome(p.short)}</td></tr>)}</tbody>
      </table></div> : null}
    </div>;
  }
  return <section id="wallet" className="card rw-panel wf-card" aria-labelledby="wf-title" style={{ scrollMarginTop: 80 }}>
    {head}
    <div className="rw-body">{body}{tx && (!account || !onAurora) ? <TxLine tx={tx} /> : null}{foot}</div>
  </section>;
}
