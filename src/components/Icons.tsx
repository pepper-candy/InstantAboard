import type { ReactNode, SVGProps } from "react";
import { MTR_MAROON, MTR_RING_STROKE, mtrRingArcs, mtrRingViewBox, taxiLogoInner } from "@/lib/logos";

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

export function IconBus(p: IconProps) {
  return svg(
    p,
    <>
      <rect x="4" y="4" width="16" height="12" rx="2" />
      <path d="M6 16v2M18 16v2M4 12h16M8 8h3M14 8h3" />
    </>,
  );
}

/** Side-view Hong Kong public light bus, traced from the minibus silhouette. */
export const MINIBUS_VIEWBOX = "0 0 880 400";

/**
 * One filled silhouette. Windows, the sliding door, belt lines, and wheel hubs
 * are cut out (evenodd) so they show the chip or marker colour behind.
 */
export const MINIBUS_PATH =
  "M172 15 H800 C838 15 847 40 847 88 V300 L858 318 L868 334 L868 348 L820 350 H703 A53 53 0 0 1 603 350 H209 A53 53 0 0 1 106 332 H20 V316 H36 V168 L57 120 L80 80 L100 46 Q138 15 172 15 Z" +
  "M138 51 H229 V138 L89 138 Z" +
  "M266 51 H370 V332 H266 Z" +
  "M407 51 H582 V138 H407 Z" +
  "M618 51 H801 V138 H618 Z" +
  "M30 157 H266 V168 H30 Z" +
  "M370 157 H855 V168 H370 Z" +
  "M30 216 H266 V227 H30 Z" +
  "M370 216 H855 V227 H370 Z" +
  "M134 332 A25 25 0 1 1 184 332 A25 25 0 1 1 134 332 Z" +
  "M628 332 A25 25 0 1 1 678 332 A25 25 0 1 1 628 332 Z";

export function IconMinibus(p: IconProps) {
  return (
    <svg fill="none" aria-hidden {...p} viewBox={MINIBUS_VIEWBOX}>
      <path fill="currentColor" fillRule="evenodd" d={MINIBUS_PATH} />
    </svg>
  );
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

export function IconFerry(p: IconProps) {
  return svg(
    p,
    <>
      <path d="M3 14l9 4 9-4-2-4H5z" />
      <path d="M8 10V7h5l2 3" />
    </>,
  );
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
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M6 10h20" />
      <path d="M12 10V7h8v3" />
      <path d="M9 10l1.2 16h11.6L23 10" />
      <path d="M13 15v7M19 15v7" />
    </svg>
  );
}

export function IconBack(p: IconProps) {
  return svg(p, <path d="M15 6l-7 6 7 6" />);
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
  return svg(
    p,
    <>
      <path d="M7 6h10M8 6v3M16 6v3" />
      <rect x="4" y="9" width="16" height="9" rx="2" />
      <path d="M7 18v2M17 18v2M4 13h16" />
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
