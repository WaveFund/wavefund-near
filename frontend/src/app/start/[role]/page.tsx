"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Icon, type IconName } from "@/components/funding/primitives";
import { PageHead } from "@/components/v2";
import { useSavedRounds } from "@/lib/arena/hooks";
import { guideFor } from "@/lib/guides.mjs";

const ICON: Record<string, IconName> = { manager: "safe", forecaster: "chart", observer: "eye" };

export default function RoleGuidePage() {
  const params = useParams<{ role: string }>();
  const { rounds } = useSavedRounds();
  const guide = guideFor(params.role, rounds ?? []);
  return <AppShell>
    <Link className="breadcrumb" href="/"><Icon name="chevron" />Home</Link>
    <PageHead eyebrow="Getting started" title={guide ? `Start as ${guide.title === "Just looking" ? "an observer" : `a ${guide.title.toLowerCase()}`}` : "Guide not found"} line={guide?.line} />
    {guide ? <div className="guide">
      <ol className="guide-steps">{guide.steps.map((step, index) => <li className="card guide-step" key={step.title}>
        <span className="guide-n num" aria-hidden="true">{index + 1}</span>
        <div className="guide-body"><span className="eyebrow">Step {index + 1} of {guide.steps.length}</span><h2>{step.title}</h2><p>{step.line}</p></div>
        <Link className={`btn ${index === 0 ? "btn-primary" : ""}`} href={step.href}>{step.button}<Icon name="arrow" /></Link>
      </li>)}</ol>
      <aside className="card guide-side"><span className="role-ico"><Icon name={ICON[guide.id] ?? "eye"} /></span><h3>Other ways in</h3>
        <ul>{["manager", "forecaster", "observer"].filter((id) => id !== guide.id).map((id) => <li key={id}><Link className="link" href={`/start/${id}`}>{id === "observer" ? "Just looking" : `As a ${id}`}<Icon name="arrow" /></Link></li>)}</ul>
        <p className="muted">Everything here uses Aurora testnet and test assets. Nothing in this app holds a key.</p></aside>
    </div> : <Link className="btn" href="/">Choose a role</Link>}
  </AppShell>;
}
