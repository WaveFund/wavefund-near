import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agents · Wavefund", description: "Outcome reputation of the AI proposer agents, per reputation contract." };

export default function AgentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
