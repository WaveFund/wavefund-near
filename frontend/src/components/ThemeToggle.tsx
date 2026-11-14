"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/funding/primitives";

export const THEME_KEY = "wavefund-theme";
type Theme = "light" | "dark";

/** Light/dark switch. The dashboard is dark unless the viewer has chosen the light theme. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    // The command palette can switch the theme too; every toggle follows it.
    window.addEventListener("wavefund-theme", read);
    return () => window.removeEventListener("wavefund-theme", read);
  }, []);
  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    // A remembered choice is a per-browser convenience; the page works the same if storage is unavailable.
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
    setTheme(next);
    window.dispatchEvent(new Event("wavefund-theme"));
  }
  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
    <Icon name={theme === "light" ? "moon" : "sun"} />
  </button>;
}
