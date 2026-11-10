import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wavefund — treasury decision markets",
  description: "Market-guided decisions for a manager-owned trading Safe. Local rehearsal and read-only Aurora testnet monitoring.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
