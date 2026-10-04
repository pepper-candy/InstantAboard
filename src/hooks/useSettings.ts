"use client";

import { useCallback, useEffect, useState } from "react";
import { applyTheme, loadSettings, saveSettings } from "@/lib/storage";
import type { BoardFilter, Lang, Settings, Theme } from "@/lib/types";

const FALLBACK: Settings = { lang: "en", theme: "dark", filter: "all", seeded: false };

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(FALLBACK);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(settings.theme);
    saveSettings(settings);
  }, [settings, hydrated]);

  const setLang = useCallback((lang: Lang) => {
    setSettings((s) => ({ ...s, lang }));
  }, []);

  const toggleLang = useCallback(() => {
    setSettings((s) => ({ ...s, lang: s.lang === "zh" ? "en" : "zh" }));
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }));
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    setSettings((s) => ({ ...s, theme }));
  }, []);

  const setFilter = useCallback((filter: BoardFilter) => {
    setSettings((s) => ({ ...s, filter: filter === "taxi" ? "all" : filter }));
  }, []);

  useEffect(() => {
    if (settings.filter === "taxi") setSettings((s) => ({ ...s, filter: "all" }));
  }, [settings.filter]);

  const markSeeded = useCallback(() => {
    setSettings((s) => ({ ...s, seeded: true }));
  }, []);

  return { settings, hydrated, setLang, toggleLang, toggleTheme, setTheme, setFilter, markSeeded };
}
