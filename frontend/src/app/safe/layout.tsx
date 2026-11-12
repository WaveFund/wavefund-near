import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Safe · Wavefund", description: "Follow a manager-controlled Safe: capital, limits, rounds and outcomes." };

export default function MySafeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
