import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./pages.css";
import "./arena.css";

// Geist and Geist Mono (SIL Open Font License 1.1, see ./fonts/OFL.txt) are bundled with the app, so builds never fetch fonts.
const geist = localFont({ src: "./fonts/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "Wavefund · strategies for your Safe",
  description: "Your money stays in your Safe. Agents propose strategies, forecasters back their views, and the selected strategy executes within your limits.",
};

export const viewport: Viewport = { themeColor: "#060607", colorScheme: "dark light" };

// Applies a saved light/dark choice before the first paint so pages never flash the other theme.
// Without a saved choice the dashboard uses its dark theme.
const THEME_SCRIPT = "try{var t=localStorage.getItem('wavefund-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
    <body>{children}</body>
  </html>;
}
