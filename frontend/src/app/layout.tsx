import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wavefund — local decision market",
  description: "A local simulation of market-guided decisions for a manager-owned trading Safe.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
