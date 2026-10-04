import type { ReactNode, SVGProps } from "react";

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

export function IconMinibus(p: IconProps) {
  return svg(
    p,
    <>
      <path d="M5 16V8a3 3 0 0 1 3-3h10l3 5v6" />
      <path d="M5 12h16M7 16v2M17 16v2" />
      <circle cx="8.5" cy="13" r="0.6" fill="currentColor" />
    </>,
  );
}

export function IconMetro(p: IconProps) {
  return svg(
    p,
    <>
      <rect x="5" y="3" width="14" height="14" rx="4" />
      <path d="M8 17l-2 4M16 17l2 4M8 10h8" />
    </>,
  );
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
  return svg(
    p,
    <>
      <path d="M4 13l2-5h12l2 5v5H4z" />
      <path d="M9 8V6h6v2M6 16v2M18 16v2" />
    </>,
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
