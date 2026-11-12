import type { Metadata } from "next";

export const metadata: Metadata = { title: "Demo portfolio · Wavefund", description: "A demo manager portfolio on Aurora testnet: holdings, latest round, funding history and permissions." };

export default function PortfolioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
