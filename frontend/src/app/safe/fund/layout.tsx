import type { Metadata } from "next";

export const metadata: Metadata = { title: "Fund a Safe · Wavefund", description: "Fund a manager's Safe: preview quotes, transfer status and readiness. Sending is disabled." };

export default function FundaSafeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
