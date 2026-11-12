import type { Metadata } from "next";

export const metadata: Metadata = { title: "Forecast arena · Wavefund", description: "Browse strategy rounds and learn how LONG and SHORT forecasting positions settle." };

export default function ForecastarenaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
