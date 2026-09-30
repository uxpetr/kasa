import type { ReactNode } from "react";

/** A small green stamp in an entry's meta line. Categories never reorder the feed. */
export function CategoryStamp({ children }: { children: ReactNode }) {
  return <span className="kasa-stamp">{children}</span>;
}

/** A filter chip above the feed. */
export function CategoryChip({
  label,
  count,
  pressed,
  onToggle,
}: {
  label: string;
  count?: number;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="kasa-chip" aria-pressed={pressed} onClick={onToggle}>
      {label}
      {/* A real space, so the name reads "Food 3", not "Food3". */}
      {count !== undefined ? <> <span className="kasa-chip-count">{count}</span></> : null}
    </button>
  );
}
