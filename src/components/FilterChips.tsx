"use client";

import { IconAll, IconBus, IconFerry, IconMetro, IconMinibus, IconTaxi, IconTram } from "./Icons";
import { useApp } from "./Providers";
import type { BoardFilter } from "@/lib/types";

const CHIPS: { id: BoardFilter; label: string; Icon: typeof IconBus }[] = [
  { id: "all", label: "All", Icon: IconAll },
  { id: "bus", label: "Bus", Icon: IconBus },
  { id: "minibus", label: "Minibus", Icon: IconMinibus },
  { id: "mtr", label: "MTR", Icon: IconMetro },
  { id: "ferry", label: "Ferry", Icon: IconFerry },
  { id: "tram", label: "Tram", Icon: IconTram },
  { id: "taxi", label: "Taxi", Icon: IconTaxi },
];

export function FilterChips() {
  const { settings, setFilter } = useApp();

  return (
    <div className="chips" role="tablist" aria-label="Filter">
      {CHIPS.map(({ id, label, Icon }) => {
        const on = settings.filter === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={label}
            className={`chip ${on ? "is-on" : ""}`}
            onClick={() => setFilter(id === "all" || on ? "all" : id)}
          >
            <Icon className="icon-md" />
          </button>
        );
      })}
    </div>
  );
}
