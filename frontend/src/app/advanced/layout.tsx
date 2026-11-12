import type { Metadata } from "next";

export const metadata: Metadata = { title: "Advanced · Wavefund", description: "Prepare unsigned Safe transactions for the local Safe owner." };

export default function AdvancedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
