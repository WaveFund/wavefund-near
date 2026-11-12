import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Testnet round · Wavefund",
  description: "Published evidence of a Wavefund strategy round on Aurora testnet: proposals, forecasters, execution, outcome and every transaction.",
};

export default function RoundLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
