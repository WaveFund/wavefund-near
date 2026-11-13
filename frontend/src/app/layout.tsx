import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./pages.css";
import "./arena.css";
import "./theme.css";

// Geist (./fonts/OFL.txt) and IBM Plex Mono (./fonts/IBMPlexMono-OFL.txt), both SIL Open Font License 1.1, are bundled
// with the app, so builds never fetch fonts.
const geist = localFont({ src: "./fonts/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const plexMono = localFont({ src: [{ path: "./fonts/IBMPlexMono-400.woff2", weight: "400" }, { path: "./fonts/IBMPlexMono-500.woff2", weight: "500" }, { path: "./fonts/IBMPlexMono-600.woff2", weight: "600" }], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Wavefund · let strategies compete",
  description: "Agents propose. Forecasters take positions. A manager-controlled Safe executes the selected strategy within its approved limits.",
};

export const viewport: Viewport = { themeColor: "#06121a", colorScheme: "dark light" };

// Applies a saved light/dark choice before the first paint so pages never flash the other theme.
// Without a saved choice the dashboard uses its dark theme.
const THEME_SCRIPT = "try{var t=localStorage.getItem('wavefund-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${plexMono.variable}`} suppressHydrationWarning>
    <head><script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
    <body>{children}</body>
  </html>;
}
