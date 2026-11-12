"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";

/** One explicit capability or provenance tag. Tone carries meaning: ok = money/success, ai = AI, warn = attention. */
export function Cap({ tone, icon, children, title }: { tone?: "ok" | "ai" | "warn" | "bad"; icon?: IconName; children: ReactNode; title?: string }) {
  return <span className={`cap ${tone ?? ""}`} title={title}>{icon ? <Icon name={icon} /> : null}{children}</span>;
}

/** A small "i" that reveals a definition on hover or keyboard focus. */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tip"><button type="button" aria-label={label}>i</button><span role="tooltip">{children}</span></span>;
}

/** Eyebrow, one H1, at most one supporting line, optional actions on the right. */
export function PageHead({ eyebrow, ai = false, title, line, actions }: { eyebrow: ReactNode; ai?: boolean; title: ReactNode; line?: ReactNode; actions?: ReactNode }) {
  return <header className="v2-head"><div className="v2-head-row"><div>
    <p className={`eyebrow ${ai ? "ai" : ""}`}><span className="pip" />{eyebrow}</p>
    <h1>{title}</h1>{line ? <p>{line}</p> : null}
  </div>{actions ? <div className="page-actions">{actions}</div> : null}</div></header>;
}

/** Right-docked native dialog. Rationale, definitions and receipts live here, opened deliberately. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="drawer" onClose={onClose} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    {open ? <><div className="drawer-head"><h2>{title}</h2><button type="button" className="drawer-close" onClick={onClose} aria-label="Close"><Icon name="cross" /></button></div>
      <div className="drawer-body">{children}</div></> : null}
  </dialog>;
}

/** A button that opens a drawer; the common "details on request" pattern. */
export function DrawerButton({ label, title, icon = "receipt", className = "btn btn-sm", children }: { label: ReactNode; title: ReactNode; icon?: IconName; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className} onClick={() => setOpen(true)}><Icon name={icon} />{label}</button>
    <Drawer open={open} onClose={() => setOpen(false)} title={title}>{children}</Drawer></>;
}
