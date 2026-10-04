"use client";

import { useEffect, useState } from "react";
import { loadEtaDb } from "@/lib/db";
import { loadTramPack, mergeTram } from "@/lib/extras";
import type { EtaDb } from "@/lib/types";

export function useDb() {
  const [db, setDb] = useState<EtaDb | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadEtaDb()
      .then(async (value) => {
        const pack = await loadTramPack();
        return mergeTram(value, pack);
      })
      .then((value) => {
        if (alive) setDb(value);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "db");
      });
    return () => {
      alive = false;
    };
  }, []);

  return { db, error };
}
