"use client";

import { Fragment } from "react";
import { BUCKET_LABELS, type FundingBucket } from "@/lib/funding/model.mjs";
import { Icon, Pill, type IconName } from "./primitives";

export type FlowState = { step: number; halted: boolean; bucket: FundingBucket | null; preview: boolean; verified: boolean; evidence: "live" | "fixture" | "none" };
type NodeStatus = "idle" | "preview" | "active" | "done" | "halted";
type LinkStatus = "idle" | "preview" | "flowing" | "done" | "halted";

const REFUND_BUCKETS: FundingBucket[] = ["refunded", "refund-partial", "refund-pending"];

function nodeStatus(state: FlowState, index: number): NodeStatus {
  if (state.bucket === "delivered") return "done";
  if (state.step === 0) return state.preview && index === 1 ? "preview" : "idle";
  if (index < state.step) return "done";
  if (index === state.step) return state.halted ? "halted" : "active";
  return "idle";
}
function linkStatus(state: FlowState, index: number): LinkStatus {
  if (state.bucket === "delivered") return "done";
  if (state.step === 0) return state.preview && index === 1 ? "preview" : "idle";
  if (index < state.step - 1) return "done";
  if (index === state.step - 1) return state.halted ? "halted" : "flowing";
  return "idle";
}

export function RouteFlow({ state, sourceLabel, safeLabel }: { state: FlowState; sourceLabel: string; safeLabel: string }) {
  const nodes: Array<{ icon: IconName; title: string; sub: string }> = [
    { icon: "wallet", title: "Manager wallet", sub: sourceLabel },
    { icon: "intents", title: "NEAR Intents", sub: "1Click solver network" },
    { icon: "aurora", title: "Aurora", sub: "NEAR virtual chain" },
    { icon: "safe", title: "Your Trading Safe", sub: safeLabel },
  ];
  const refund = state.bucket !== null && REFUND_BUCKETS.includes(state.bucket);
  const caption = state.bucket ? BUCKET_LABELS[state.bucket]
    : state.preview ? "Dry-quote preview · nothing moves"
    : "Preview a route to see how funds would travel";
  return <figure className={`route-flow ${state.bucket === "delivered" ? "is-delivered" : ""}`} aria-label={`Funding route: ${caption}`}>
    <div className="route-flow-head">
      <span className="kicker muted">Funding route</span>
      <span className="route-flow-tags">
        {state.evidence === "fixture" && <Pill tone="fixture">Fixture</Pill>}
        {state.verified && <Pill tone="success"><Icon name="check" />Verified</Pill>}
      </span>
    </div>
    <ol className="route-track">
      {nodes.map((node, i) => {
        const index = i + 1;
        const status = nodeStatus(state, index);
        return <Fragment key={node.title}>
          <li className={`route-node node-${status}`}>
            <span className="route-node-icon"><Icon name={status === "done" ? "check" : status === "halted" ? "alert" : node.icon} /></span>
            <span className="route-node-title">{node.title}</span>
            <span className="route-node-sub">{node.sub}</span>
          </li>
          {index < nodes.length && <li aria-hidden="true" className={`route-link link-${linkStatus(state, index)}`}><span /></li>}
        </Fragment>;
      })}
    </ol>
    {refund && <div className="route-refund"><Icon name="refund" />Refund path · back to the manager wallet on the source chain</div>}
    <figcaption className={`route-caption tone-${state.halted ? "warning" : state.bucket === "delivered" ? "success" : "neutral"}`}>{caption}</figcaption>
  </figure>;
}
