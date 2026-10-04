"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBoard, IconMoon, IconPlus, IconSun } from "./Icons";
import { useApp } from "./Providers";

export function NavBar() {
  const pathname = usePathname();
  const { settings, toggleLang, toggleTheme } = useApp();
  const home = pathname === "/";
  const add = pathname.startsWith("/add");

  return (
    <nav className="nav" aria-label="InstantAboard">
      <Link href="/" className={`nav-btn ${home ? "is-on" : ""}`} aria-label="Board" aria-current={home ? "page" : undefined}>
        <IconBoard className="icon-lg" />
      </Link>
      <Link href="/add" className={`nav-btn ${add ? "is-on" : ""}`} aria-label="Add" aria-current={add ? "page" : undefined}>
        <IconPlus className="icon-lg" />
      </Link>
      <button type="button" className="nav-btn" onClick={toggleTheme} aria-label={settings.theme === "dark" ? "Light" : "Dark"}>
        {settings.theme === "dark" ? <IconSun className="icon-lg" /> : <IconMoon className="icon-lg" />}
      </button>
      <button type="button" className="nav-btn" onClick={toggleLang} aria-label={settings.lang === "zh" ? "English" : "繁中"}>
        <span className="nav-lang">{settings.lang === "zh" ? "EN" : "繁"}</span>
      </button>
    </nav>
  );
}
