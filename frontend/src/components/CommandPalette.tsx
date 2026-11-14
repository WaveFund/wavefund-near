"use client";

// ⌘K / Ctrl+K quick navigation. Pages and saved rounds only; it never triggers a transaction or a backend action.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";
import { loadRoundEvidence } from "@/lib/record/loader";
import { STATIC_DATA } from "@/lib/record/static-data";
import { roundSummary } from "@/lib/arena/model.mjs";
import type { TestnetRound } from "@/lib/record/model.mjs";
import { THEME_KEY } from "@/components/ThemeToggle";

type Item = { id: string; group: "Pages" | "Rounds" | "Actions"; label: string; hint?: string; meta?: string; icon: IconName; keywords: string; run: () => void };

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen((value) => !value); }
      else if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); setOpen(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rounds, setRounds] = useState<TestnetRound[] | null>(null);

  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); setQuery(""); setActive(0); requestAnimationFrame(() => input.current?.focus()); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  // Saved rounds are read only once the palette is first opened.
  useEffect(() => {
    if (!open || rounds) return;
    let live = true;
    loadRoundEvidence().then((next) => { if (live) setRounds(next); }, () => { if (live) setRounds([]); });
    return () => { live = false; };
  }, [open, rounds]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => { onClose(); router.push(href); };
    const pages: Item[] = [
      { id: "home", group: "Pages", label: "Home", hint: "Overview and how a round works", icon: "spark", keywords: "start overview", run: go("/") },
      { id: "rounds", group: "Pages", label: "Rounds", hint: "Every saved Aurora testnet round", icon: "layers", keywords: "history list", run: go("/rounds") },
      ...(!STATIC_DATA ? [
        { id: "live", group: "Pages" as const, label: "Live round", hint: "Watch the testnet round and forecast from your wallet", icon: "pulse" as IconName, keywords: "wallet trade forecast metamask", run: go("/rounds/live") },
        { id: "local", group: "Pages" as const, label: "Local simulation", hint: "Run a disposable round on a local chain", icon: "play" as IconName, keywords: "demo run simulate", run: go("/rounds/local") },
      ] : []),
      { id: "agents", group: "Pages", label: "Agents", hint: "Proposer outcome reputation", icon: "users", keywords: "leaderboard reputation ai model", run: go("/agents") },
      { id: "portfolio", group: "Pages", label: "Portfolio", hint: "The demo Safe: holdings, history, permissions", icon: "safe", keywords: "safe holdings treasury", run: go("/portfolio") },
      { id: "fund", group: "Pages", label: "Funding preview", hint: "NEAR Intents 1Click quotes · sending disabled", icon: "fund", keywords: "deposit intents 1click tidepool bridge", run: go("/portfolio/fund") },
      ...(!STATIC_DATA ? [{ id: "advanced", group: "Pages" as const, label: "Advanced owner tools", hint: "Prepare unsigned Safe transactions", icon: "sliders" as IconName, keywords: "owner module slippage", run: go("/advanced") }] : []),
    ];
    const saved: Item[] = [...(rounds ?? [])].reverse().map((round) => {
      const summary = roundSummary(round);
      return { id: round.slug, group: "Rounds", label: `Round ${round.roundId} · ${round.stack.label}`, hint: `${summary.selectedName} selected${round.date ? ` · ${round.date}` : ""}`, meta: summary.measured ?? undefined,
        icon: "receipt", keywords: `round ${round.roundId} ${summary.selectedName} ${round.stack.label}`, run: go(`/rounds/${round.slug}`) };
    });
    const actions: Item[] = [{ id: "theme", group: "Actions", label: "Toggle light / dark theme", icon: "sun", keywords: "theme dark light mode", run: () => {
      const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { window.localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
      window.dispatchEvent(new Event("wavefund-theme")); onClose();
    } }];
    return [...pages, ...saved, ...actions];
  }, [rounds, router, onClose]);

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((item) => `${item.label} ${item.hint ?? ""} ${item.keywords}`.toLowerCase().includes(q)) : items;
  const index = Math.min(active, Math.max(0, shown.length - 1));

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index + 1) % Math.max(1, shown.length)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index - 1 + shown.length) % Math.max(1, shown.length)); }
    else if (event.key === "Enter") { event.preventDefault(); shown[index]?.run(); }
  }
  useEffect(() => { document.getElementById(`cmdk-${shown[index]?.id}`)?.scrollIntoView({ block: "nearest" }); }, [index, shown]);

  let lastGroup = "";
  return <dialog ref={ref} className="cmdk" aria-label="Search Wavefund" onClose={onClose} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    {open ? <>
      <div className="cmdk-input"><Icon name="search" />
        <input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKey} placeholder="Search pages and rounds…" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={shown[index] ? `cmdk-${shown[index].id}` : undefined} autoComplete="off" spellCheck={false} />
        <kbd>esc</kbd></div>
      <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results">
        {shown.length === 0 ? <p className="cmdk-empty">No page or round matches “{query}”.</p> : shown.map((item, i) => {
          const head = item.group !== lastGroup ? <div className="cmdk-group" role="presentation">{item.group === "Rounds" && rounds === null ? "Rounds · loading…" : item.group}</div> : null;
          lastGroup = item.group;
          return <div key={item.id} role="presentation">{head}
            <button type="button" id={`cmdk-${item.id}`} role="option" aria-selected={i === index} className="cmdk-item" onMouseMove={() => setActive(i)} onClick={item.run}>
              <span className="cmdk-ico"><Icon name={item.icon} /></span><span><span>{item.label}</span>{item.hint ? <small>{item.hint}</small> : null}</span>
              {item.meta ? <span className="cmdk-meta num">{item.meta}</span> : null}
            </button></div>;
        })}
      </div>
      <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
    </> : null}
  </dialog>;
}
