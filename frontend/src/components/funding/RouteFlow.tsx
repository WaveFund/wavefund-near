import { BUCKET_LABELS, type FundingBucket } from "@/lib/funding/model.mjs";
import type { FlowStep } from "./FundingPanels";

export type FlowState = { step: number; halted: boolean; bucket: FundingBucket | null; preview: boolean; verified: boolean; evidence: "live" | "fixture" | "none" };

/** The four hops of a deposit, with each hop's state derived from the classified funding record (or the preview). */
export function flowSteps(state: FlowState, sourceLabel: string, safeLabel: string): FlowStep[] {
  const hops = [
    { title: "Manager wallet", sub: sourceLabel },
    { title: "NEAR Intents", sub: "1Click solver network" },
    { title: "Aurora", sub: "NEAR virtual chain" },
    { title: "Trading Safe", sub: safeLabel },
  ];
  return hops.map((hop, i) => {
    const index = i + 1;
    const status: FlowStep["state"] = state.bucket === "delivered" ? "done"
      : state.step === 0 ? (state.preview && index === 1 ? "preview" : "idle")
      : index < state.step ? "done" : index === state.step ? (state.halted ? "halted" : "active") : "idle";
    return { ...hop, state: status };
  });
}

export function flowCaption(state: FlowState): string {
  return state.bucket ? BUCKET_LABELS[state.bucket] : state.preview ? "Preview only · nothing moves" : "Get a quote to see the route";
}
