import type { Metadata } from "next";
import "./globals.css";
import "./pages.css";
import "./arena.css";

export const metadata: Metadata = {
  title: "Wavefund · strategies for your Safe",
  description: "Your money stays in your Safe. Agents propose strategies, forecasters back their views, and the selected strategy executes within your limits.",
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
