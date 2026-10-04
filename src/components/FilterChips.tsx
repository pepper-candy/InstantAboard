"use client";

import { IconBus, IconFerry, IconMetro, IconMinibus, IconTaxi } from "./Icons";
import { useApp } from "./Providers";
import type { BoardFilter } from "@/lib/types";

const CHIPS: { id: Exclude<BoardFilter, "all">; label: string; Icon: typeof IconBus }[] = [
  { id: "bus", label: "Bus", Icon: IconBus },
  { id: "minibus", label: "Minibus", Icon: IconMinibus },
  { id: "mtr", label: "MTR", Icon: IconMetro },
  { id: "ferry", label: "Ferry", Icon: IconFerry },
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
            onClick={() => setFilter(on ? "all" : id)}
          >
            <Icon className="icon-md" />
          </button>
        );
      })}
    </div>
  );
}
