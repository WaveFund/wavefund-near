import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Wavefund",
  description: "Inspect the Wavefund Safe and module, and prepare owner actions as unsigned Safe transactions.",
};

export default function ManagerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
