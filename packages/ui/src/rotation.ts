import type { CSSProperties } from "react";
import { tokens } from "./tokens";

/** Objects tilt a little, never more than the token limit (design rules: under 2.5°). */
export function clampRotation(degrees: number): number {
  const max = tokens.motion.maxRotationDeg;
  if (!Number.isFinite(degrees)) return 0;
  return Math.max(-max, Math.min(max, degrees));
}

export function objectStyle(rotate: number | undefined, extra?: Record<string, string | number>): CSSProperties {
  return { "--kasa-rotate": `${clampRotation(rotate ?? 0)}deg`, ...extra } as CSSProperties;
}

/** A stable, gentle tilt per entry, so the pile looks hand-placed but doesn't jump on re-render. */
export function tiltFor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 41) - 20) / 10; // -2.0° to 2.0°
}
