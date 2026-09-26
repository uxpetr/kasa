import type { ReactNode } from "react";
import { objectStyle } from "../rotation";

export interface Pin {
  number: number;
  /** Fractions of the image width and height, 0 to 1. */
  x: number;
  y: number;
}

interface PinMarkerProps extends Pin {
  /** True while this pin's thread is open. */
  open?: boolean;
  onSelect?: (pin: number) => void;
}

export function PinMarker({ number, x, y, open, onSelect }: PinMarkerProps) {
  const style = { "--kasa-pin-x": clamp01(x), "--kasa-pin-y": clamp01(y) } as React.CSSProperties;
  if (!onSelect) {
    return (
      <span className="kasa-pin" style={style} aria-hidden="true">
        {number}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="kasa-pin"
      style={style}
      aria-label={`Pin ${number}`}
      aria-expanded={open ?? false}
      onClick={() => onSelect(number)}
    >
      {number}
    </button>
  );
}

interface PrintProps {
  src: string;
  alt: string;
  rotate?: number;
  tape?: boolean;
  pins?: Pin[];
  openPin?: number;
  onSelectPin?: (pin: number) => void;
  /** Ink layer for drawings, drawn over the image (hidden with "Hide ink"). */
  overlay?: ReactNode;
  imageHeight?: number;
  children?: ReactNode;
}

/** A capture or drawing: a print of the page, taped down, with numbered pins. */
export function Print({ src, alt, rotate = 1, tape = true, pins = [], openPin, onSelectPin, overlay, imageHeight = 150, children }: PrintProps) {
  return (
    <figure className="kasa-object kasa-print" style={{ ...objectStyle(rotate, { "--kasa-image-height": `${imageHeight}px` }), margin: 0 }}>
      {tape ? <span className="kasa-tape" aria-hidden="true" /> : null}
      <div className="kasa-print-image">
        <img src={src} alt={alt} />
        {overlay}
        {pins.map((pin) => (
          <PinMarker key={pin.number} {...pin} open={openPin === pin.number} onSelect={onSelectPin} />
        ))}
      </div>
      {children ? <figcaption className="kasa-print-footer">{children}</figcaption> : null}
    </figure>
  );
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
