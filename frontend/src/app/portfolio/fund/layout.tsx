import type { Metadata } from "next";

export const metadata: Metadata = { title: "Funding preview · Wavefund", description: "Official mainnet dry quotes and a completed testnet transfer. Sending is disabled." };

export default function FundingPreviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
