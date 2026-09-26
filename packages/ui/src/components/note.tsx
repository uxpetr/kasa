import type { ReactNode } from "react";
import { objectStyle } from "../rotation";

/** Past this length a note moves from a sticky to a lined sheet, so a sticky never overflows (D-135). */
export const STICKY_MAX_CHARS = 140;

export function noteVariant(text: string): "sticky" | "lined" {
  return text.length > STICKY_MAX_CHARS || text.split("\n").length > 4 ? "lined" : "sticky";
}

interface PaperProps {
  children: ReactNode;
  rotate?: number;
}

export function Sticky({ children, rotate = -1.2 }: PaperProps) {
  return (
    <div className="kasa-object kasa-sticky" style={objectStyle(rotate)}>
      {children}
    </div>
  );
}

export function LinedSheet({ children, rotate = 1 }: PaperProps) {
  return (
    <div className="kasa-object kasa-lined" style={objectStyle(rotate)}>
      {children}
    </div>
  );
}

/** A note entry: picks the paper by length. The author goes in the meta line, never the paper colour. */
export function Note({ text, rotate }: { text: string; rotate?: number }) {
  return noteVariant(text) === "sticky" ? <Sticky rotate={rotate}>{text}</Sticky> : <LinedSheet rotate={rotate}>{text}</LinedSheet>;
}
