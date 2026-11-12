import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track record — Wavefund",
  description: "Performance reputation of Wavefund's AI strategy proposers on Aurora testnet, and the published evidence of the latest testnet rounds.",
};

export default function RecordLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
