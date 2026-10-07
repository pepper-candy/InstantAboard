"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconBoard, IconMoon, IconPlus, IconSun } from "./Icons";
import { openLayer } from "@/lib/backLayer";
import { useApp } from "./Providers";

const HOLD_MS = 5000;
const ARM_WAIT_MS = 5000;

type Badge = { x: number; y: number; kind: "dev" | "norm" };

export function NavBar() {
  const pathname = usePathname();
  const { settings, toggleLang, toggleTheme, devOn, devArmed, armDev, confirmDev, cancelDev, exitDev, adding, setAdding, goHome } =
    useApp();
  const home = pathname === "/" && !adding;
  const add = pathname.startsWith("/add") || adding;
  const langRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const suppressUntil = useRef(0);
  const [badge, setBadge] = useState<Badge | null>(null);

  useEffect(() => {
    if (!devArmed && badge?.kind === "dev") setBadge(null);
  }, [devArmed, badge]);

  useEffect(() => {
    if (!badge) return;
    const onDown = (e: PointerEvent) => {
      const node = e.target instanceof Element ? e.target : null;
      if (badge.kind === "dev" && node?.closest('a[aria-label="Add"]')) return;
      if (node?.closest(".nav-lang-btn") && Date.now() < suppressUntil.current) return;
      if (badge.kind === "dev") cancelDev();
      else setBadge(null);
    };
    const expire = badge.kind === "dev" ? window.setTimeout(cancelDev, ARM_WAIT_MS) : 0;
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      if (expire) window.clearTimeout(expire);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [badge, cancelDev]);

  useEffect(
    () => () => {
      if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
    },
    [],
  );

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
      const pos = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
      if (devOn) {
        exitDev();
        setBadge({ ...pos, kind: "norm" });
        return;
      }
      setBadge({ ...pos, kind: "dev" });
      armDev();
    }, HOLD_MS);
  }

  return (
    <nav className="nav" aria-label="InstantAboard">
      <Link
        href="/"
        className={`nav-btn ${home ? "is-on" : ""}`}
        aria-label="Board"
        aria-current={home ? "page" : undefined}
        onClick={(e) => {
          if (pathname === "/") e.preventDefault();
          goHome();
        }}
      >
        <IconBoard className="icon-lg" />
      </Link>
      <Link
        href="/add"
        className={`nav-btn ${add ? "is-on" : ""}`}
        aria-label="Add"
        aria-current={add ? "page" : undefined}
        onClick={(e) => {
          if (devArmed) {
            e.preventDefault();
            confirmDev();
            return;
          }
          if (badge?.kind === "norm") {
            e.preventDefault();
            setBadge(null);
            return;
          }
          e.preventDefault();
          if (!adding) {
            openLayer(() => setAdding(false), "search");
            setAdding(true);
          }
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
          {badge.kind}
        </span>
      ) : null}
    </nav>
  );
}
