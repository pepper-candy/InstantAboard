"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconAll, IconBus, IconFerry, IconMinibus, IconTaxi, IconTram, MtrLogo } from "./Icons";
import { useApp } from "./Providers";
import type { BoardFilter, Mode } from "@/lib/types";

const HOLD_MS = 450;
const TIP_MS = 900;
const MOVE_PX = 10;

const CHIPS: { id: BoardFilter; label: string; Icon: typeof IconBus; iconClass?: string }[] = [
  { id: "all", label: "All", Icon: IconAll },
  { id: "bus", label: "Bus", Icon: IconBus },
  { id: "minibus", label: "Minibus", Icon: IconMinibus, iconClass: "kind-minibus" },
  { id: "mtr", label: "MTR", Icon: MtrLogo },
  { id: "ferry", label: "Ferry", Icon: IconFerry, iconClass: "kind-ferry" },
  { id: "tram", label: "Tram", Icon: IconTram, iconClass: "kind-tram" },
  { id: "taxi", label: "Taxi", Icon: IconTaxi, iconClass: "kind-taxi" },
];

const PEEK_KIND: Record<Mode, { label: string; Icon: typeof IconBus; iconClass: string }> = {
  taxi: { label: "Taxi", Icon: IconTaxi, iconClass: "kind-taxi" },
  bus: { label: "Bus", Icon: IconBus, iconClass: "icon-md" },
  minibus: { label: "Minibus", Icon: IconMinibus, iconClass: "kind-minibus" },
  mtr: { label: "MTR", Icon: MtrLogo, iconClass: "icon-md logo-icon" },
  ferry: { label: "Ferry", Icon: IconFerry, iconClass: "kind-ferry" },
  tram: { label: "Tram", Icon: IconTram, iconClass: "kind-tram" },
};

type Tip = { label: string; x: number; y: number; below: boolean };

export function FilterChips({
  onClosePeek,
  peekMode,
  routeChip,
}: {
  onClosePeek?: () => void;
  peekMode?: Mode;
  routeChip?: ReactNode;
}) {
  const { settings, setFilter } = useApp();
  const [tip, setTip] = useState<Tip | null>(null);
  const holdRef = useRef<number | null>(null);
  const hideRef = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const tipOn = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const endPress = useRef<() => void>(() => {});

  const clearHold = () => {
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
    origin.current = null;
  };

  const hideTip = () => {
    if (hideRef.current != null) {
      window.clearTimeout(hideRef.current);
      hideRef.current = null;
    }
    if (!tipOn.current) return;
    tipOn.current = false;
    setTip(null);
  };

  endPress.current = () => {
    clearHold();
    if (tipOn.current) hideTip();
  };

  useEffect(() => {
    const end = () => endPress.current();
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (holdRef.current != null) window.clearTimeout(holdRef.current);
      if (hideRef.current != null) window.clearTimeout(hideRef.current);
    };
  }, []);

  const showTip = (el: HTMLElement, label: string) => {
    const rect = el.getBoundingClientRect();
    const below = rect.top < 64;
    const half = 48;
    tipOn.current = true;
    suppressClick.current = true;
    setTip({
      label,
      x: Math.min(window.innerWidth - half, Math.max(half, rect.left + rect.width / 2)),
      y: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
    if (hideRef.current != null) window.clearTimeout(hideRef.current);
    hideRef.current = window.setTimeout(() => {
      hideRef.current = null;
      tipOn.current = false;
      setTip(null);
    }, TIP_MS);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, label: string) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    clearHold();
    hideTip();
    suppressClick.current = false;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer */
    }
    origin.current = { x: e.clientX, y: e.clientY };
    holdRef.current = window.setTimeout(() => {
      holdRef.current = null;
      showTip(el, label);
    }, HOLD_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const start = origin.current;
    if (!start || holdRef.current == null) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_PX) clearHold();
  };

  const run = (e: MouseEvent<HTMLButtonElement>, action: () => void) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      return;
    }
    action();
  };

  const holdProps = (label: string, action: () => void) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => onPointerDown(e, label),
    onPointerMove,
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault(),
    onClick: (e: MouseEvent<HTMLButtonElement>) => run(e, action),
  });

  return (
    <div className="chips" role="tablist" aria-label="Filter">
      {onClosePeek ? (
        <>
          <button type="button" className="chip is-on chip-close" aria-label="Close" {...holdProps("Close", onClosePeek)}>
            ×
          </button>
          {routeChip ??
            (peekMode ? (
              <PeekKind
                mode={peekMode}
                onOpen={() => {
                  setFilter(peekMode);
                  onClosePeek();
                }}
              />
            ) : null)}
        </>
      ) : (
        CHIPS.map(({ id, label, Icon, iconClass }) => {
          const on = settings.filter === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={label}
              className={`chip ${on ? "is-on" : ""}`}
              {...holdProps(label, () => setFilter(id === "all" || on ? "all" : id))}
            >
              <Icon className={iconClass ?? (id === "mtr" ? "icon-md logo-icon" : "icon-md")} />
            </button>
          );
        })
      )}
      <ChipTip tip={tip} />
    </div>
  );
}

function PeekKind({ mode, onOpen }: { mode: Mode; onOpen: () => void }) {
  const { label, Icon, iconClass } = PEEK_KIND[mode];
  return (
    <button type="button" className="chip chip-kind" aria-label={label} onClick={onOpen}>
      <Icon className={iconClass} />
      <span>{label}</span>
    </button>
  );
}

function ChipTip({ tip }: { tip: Tip | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!tip || !mounted) return null;
  return createPortal(
    <span className={`chip-tip${tip.below ? " is-below" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.label}
    </span>,
    document.body,
  ) as ReactNode;
}
