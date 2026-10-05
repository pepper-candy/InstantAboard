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

export function IconPinpoint(p: IconProps) {
  return svg(
    p,
    <>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" />
      <circle cx="12" cy="11" r="2" />
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
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden {...p} dangerouslySetInnerHTML={{ __html: tramLogoInner }} />
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
