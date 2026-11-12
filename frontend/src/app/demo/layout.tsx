import type { Metadata } from "next";

export const metadata: Metadata = { title: "Demo · Wavefund", description: "Run a local Wavefund round or walk through the completed public testnet run." };

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
