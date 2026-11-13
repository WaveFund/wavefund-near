"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHead } from "@/components/v2";
import { useSavedRounds } from "@/lib/arena/hooks";
import { guideFor } from "@/lib/guides.mjs";

export default function RoleGuidePage() {
  const params = useParams<{ role: string }>();
  const { rounds } = useSavedRounds();
  const guide = guideFor(params.role, rounds ?? []);
  return <AppShell>
    <Link className="breadcrumb" href="/">← Home</Link>
    <PageHead eyebrow="Getting started" title={guide ? `Start as ${guide.title === "Just looking" ? "an observer" : `a ${guide.title.toLowerCase()}`}` : "Guide not found"} line={guide?.line} />
    {guide ? <ol className="stack" style={{ listStyle: "none", padding: 0 }}>{guide.steps.map((step, index) => <li className="card" key={step.title} style={{ padding: 24 }}>
      <span className="eyebrow">Step {index + 1}</span><h2>{step.title}</h2><p style={{ margin: "8px 0 16px" }}>{step.line}</p>
      <Link className="btn btn-primary" href={step.href}>{step.button}</Link>
    </li>)}</ol> : <Link className="btn" href="/">Choose a role</Link>}
  </AppShell>;
}
