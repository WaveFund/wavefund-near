import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fund your Trading Safe — Wavefund",
  description: "Preview NEAR Intents funding into a manager-owned Aurora mainnet Trading Safe before a round. Dry quotes only; signing is disabled.",
};

export default function FundLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
