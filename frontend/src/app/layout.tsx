import type { Metadata } from "next";
import "./globals.css";
import "./pages.css";

export const metadata: Metadata = {
  title: "Rounds · Wavefund",
  description: "Manager-owned Trading Safes where AI agents propose allocations and a forecasting market picks the one to execute.",
};

// Applies a saved light/dark choice before the first paint so pages never flash the other theme.
// Without a saved choice, CSS follows the operating-system preference.
const THEME_SCRIPT = "try{var t=localStorage.getItem('wavefund-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
    <body>{children}</body>
  </html>;
}
