import type { ReactNode, SVGProps } from "react";
import { MTR_MAROON, MTR_RING_STROKE, mtrRingArcs, mtrRingViewBox, taxiLogoInner, tramLogoInner } from "@/lib/logos";

type IconProps = SVGProps<SVGSVGElement>;

function svg(props: IconProps, path: ReactNode) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {path}
    </svg>
  );
}

export function IconBoard(p: IconProps) {
  return svg(
    p,
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9h4M7 13h10M7 17h7" />
    </>,
  );
}

export function IconPlus(p: IconProps) {
  return svg(p, <path d="M12 5v14M5 12h14" />);
}

export function IconPushpin(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden {...p}>
      <path d="M12 3.2 14.6 8.6l6 .9-4.3 4.2 1 5.9L12 16.8 6.7 19.6l1-5.9-4.3-4.2 6-.9L12 3.2z" />
    </svg>
  );
}

/** Two pointed arrows swapping direction (⇄). */
export function IconSwapDir(p: IconProps) {
  return svg(
    p,
    <>
      <path d="M7 8h11M14 5l4 3-4 3" />
      <path d="M17 16H6M10 13l-4 3 4 3" />
    </>,
  );
}

export function IconPinpoint(p: IconProps) {
  return svg(
    p,
    <>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" />
      <circle cx="12" cy="11" r="2" />
    </>,
  );
}

export function IconLock(p: IconProps) {
  return svg(
    p,
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>,
  );
}

export function IconSignal(p: IconProps) {
  return svg(
    p,
    <>
      <path d="M5 9a9 9 0 0 1 14 0" />
      <path d="M8 12a5 5 0 0 1 8 0" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
      <path d="M12 16v4" />
    </>,
  );
}

/** No-Wi-Fi mark: circle, wifi arcs, center dot, and a TR→BL slash. */
export function IconOffline(p: IconProps) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden {...p}>
      <g fill="none" stroke="currentColor" strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="50" cy="50" r="36" />
      </g>
      <circle cx="50" cy="67" r="4" fill="currentColor" />
      <path d="M39.5 58.5 A15 15 0 0 1 60.5 58.5" fill="none" stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" />
      <path d="M32 50 A23 23 0 0 1 68 50" fill="none" stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" />
      <path d="M25 41.5 A31 31 0 0 1 75 41.5" fill="none" stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" />
      <line x1="73" y1="27" x2="27" y2="73" stroke="currentColor" strokeWidth={7.5} strokeLinecap="round" />
    </svg>
  );
}

export function IconSun(p: IconProps) {
  return svg(
    p,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>,
  );
}

export function IconMoon(p: IconProps) {
  return svg(p, <path d="M16 3a8 8 0 1 0 5 13 7 7 0 0 1-5-13z" />);
}

export function IconBus({ className }: IconProps) {
  return <span className={className ? `bus-mark ${className}` : "bus-mark"} aria-hidden />;
}

export function IconMinibus({ className }: IconProps) {
  return <span className={className ? `minibus-mark ${className}` : "minibus-mark"} aria-hidden />;
}

export function MtrLogo({ line, lines, ...p }: IconProps & { line?: string; lines?: string[] }) {
  const arcs = mtrRingArcs(lines?.length ? lines : line ? [line] : []);
  return (
    <svg viewBox={mtrRingViewBox(arcs.length > 0)} fill="none" aria-hidden {...p}>
      {arcs.map((arc, i) => (
        <path key={`${arc.color}-${i}`} d={arc.d} stroke={arc.color} strokeWidth={MTR_RING_STROKE} strokeLinecap="butt" />
      ))}
      <ellipse cx="33" cy="26" rx="32" ry="26" fill={MTR_MAROON} />
      <path d="M 33,8 V 44 M 21,9 A 12,12 0 0 0 45,9 M 21,43 A 12,12 0 0 1 45,43" stroke="white" strokeWidth={5} />
    </svg>
  );
}

export function IconMetro(p: IconProps) {
  return <MtrLogo {...p} />;
}

export function IconFerry({ className }: IconProps) {
  return <span className={className ? `ferry-mark ${className}` : "ferry-mark"} aria-hidden />;
}

export function IconTaxi(p: IconProps) {
  return (
    <svg
      fill="none"
      aria-hidden
      {...p}
      viewBox="0 0 170 100"
      dangerouslySetInnerHTML={{ __html: taxiLogoInner }}
    />
  );
}

export function IconGrip(p: IconProps) {
  return svg(
    p,
    <>
      <circle cx="9" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>,
  );
}

export function IconBin(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
      <rect x="9.25" y="1.4" width="5.5" height="2.35" rx="1.15" />
      <rect x="3.6" y="4.35" width="16.8" height="3.05" rx="1.4" />
      <path
        fillRule="evenodd"
        d="M6.15 8.55c0-.72.58-1.3 1.3-1.3h9.1c.72 0 1.3.58 1.3 1.3v10.15c0 1.52-1.23 2.75-2.75 2.75H8.9c-1.52 0-2.75-1.23-2.75-2.75V8.55Zm3.55 1.55c.42 0 .75.34.75.78v6.45c0 .44-.33.78-.75.78s-.75-.34-.75-.78V10.88c0-.44.33-.78.75-.78Zm2.3 0c.42 0 .75.34.75.78v6.45c0 .44-.33.78-.75.78s-.75-.34-.75-.78V10.88c0-.44.33-.78.75-.78Zm2.3 0c.42 0 .75.34.75.78v6.45c0 .44-.33.78-.75.78s-.75-.34-.75-.78V10.88c0-.44.33-.78.75-.78Z"
      />
    </svg>
  );
}

export function IconX(p: IconProps) {
  return svg(p, <path d="M6 6l12 12M18 6L6 18" />);
}

export function IconBack(p: IconProps) {
  return svg(p, <path d="M15 6l-7 6 7 6" />);
}

export function IconChevron(p: IconProps) {
  return svg(p, <path d="M6 9l6 6 6-6" />);
}

export function IconSearch(p: IconProps) {
  return svg(
    p,
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l5 5" />
    </>,
  );
}

export function IconPin(p: IconProps) {
  return svg(p, <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 11.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z" />);
}

export function IconUndo(p: IconProps) {
  return svg(p, <path d="M9 7L5 11l4 4M5 11h10a5 5 0 0 1 0 10h-3" />);
}

export function IconDot(p: IconProps) {
  return svg(p, <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />);
}

export function IconSpinner(p: IconProps) {
  return svg(p, <path d="M12 4a8 8 0 1 1-6.3 3.1" />);
}

export function IconAll(p: IconProps) {
  return svg(
    p,
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>,
  );
}

export function IconTram(p: IconProps) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden {...p} dangerouslySetInnerHTML={{ __html: tramLogoInner }} />
  );
}

export function IconInfo(p: IconProps) {
  return svg(
    p,
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </>,
  );
}

export function IconLocate(p: IconProps) {
  return svg(
    p,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>,
  );
}

export function IconPinDot(p: IconProps) {
  return svg(p, <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />);
}

export function IconTraffic(p: IconProps) {
  return svg(
    p,
    <>
      <rect x="8" y="3" width="8" height="18" rx="3" />
      <circle cx="12" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none" />
    </>,
  );
}
