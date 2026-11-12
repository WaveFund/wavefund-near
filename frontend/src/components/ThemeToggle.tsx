"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/funding/primitives";

export const THEME_KEY = "wavefund-theme";
type Theme = "light" | "dark";

/** Light/dark switch. Without a saved choice the operating-system preference applies (and is followed live). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolve = (): Theme => {
      const chosen = root.getAttribute("data-theme");
      return chosen === "dark" || chosen === "light" ? chosen : media.matches ? "dark" : "light";
    };
    setTheme(resolve());
    const follow = () => setTheme(resolve());
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    // A remembered choice is a per-browser convenience; the page works the same if storage is unavailable.
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
    setTheme(next);
  }
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
    <Icon name={theme === "dark" ? "sun" : "moon"} />
  </button>;
}
