"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconBoard, IconMoon, IconPlus, IconSun } from "./Icons";
import { useApp } from "./Providers";

const HOLD_MS = 5000;

export function NavBar() {
  const pathname = usePathname();
  const { settings, toggleLang, toggleTheme, devArmed, armDev, confirmDev } = useApp();
  const home = pathname === "/";
  const add = pathname.startsWith("/add");
  const langRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const suppressUntil = useRef(0);
  const [badge, setBadge] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!devArmed) setBadge(null);
  }, [devArmed]);

  useEffect(() => () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
  }, []);

  function clearHold() {
    if (holdTimer.current == null) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  function onLangDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    clearHold();
    const el = langRef.current;
    const stop = () => {
      clearHold();
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      suppressUntil.current = Date.now() + 800;
      const rect = el?.getBoundingClientRect();
      if (rect) setBadge({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      armDev();
    }, HOLD_MS);
  }

  return (
    <nav className="nav" aria-label="InstantAboard">
      <Link href="/" className={`nav-btn ${home ? "is-on" : ""}`} aria-label="Board" aria-current={home ? "page" : undefined}>
        <IconBoard className="icon-lg" />
      </Link>
      <Link
        href="/add"
        className={`nav-btn ${add ? "is-on" : ""}`}
        aria-label="Add"
        aria-current={add ? "page" : undefined}
        onClick={() => {
          if (devArmed) confirmDev();
        }}
      >
        <IconPlus className="icon-lg" />
      </Link>
      <button type="button" className="nav-btn" onClick={toggleTheme} aria-label={settings.theme === "dark" ? "Light" : "Dark"}>
        {settings.theme === "dark" ? <IconSun className="icon-lg" /> : <IconMoon className="icon-lg" />}
      </button>
      <button
        ref={langRef}
        type="button"
        className="nav-btn nav-lang-btn"
        aria-label={settings.lang === "zh" ? "English" : "繁中"}
        onPointerDown={onLangDown}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (Date.now() < suppressUntil.current) return;
          toggleLang();
        }}
      >
        <span className="nav-lang">{settings.lang === "zh" ? "EN" : "繁"}</span>
      </button>
      {badge ? (
        <span className="dev-arm" style={{ left: badge.x, top: badge.y }}>
          dev
        </span>
      ) : null}
    </nav>
  );
}
