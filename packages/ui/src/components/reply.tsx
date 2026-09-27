import type { ReactNode } from "react";

interface ReplyProps {
  /** Small print of the original (an image or a few words). */
  quote: ReactNode;
  /** Accessible name of the print, such as "Go to Mika's note". */
  quoteLabel: string;
  /** Kind of paper for a text quote: a sticky for notes, pine paper for the bot, white otherwise. */
  paper?: "note" | "bot" | "plain";
  /** Tapping the clipped print jumps to the original. */
  onSelectQuote?: () => void;
  children: ReactNode;
}

/** A reply: the answer paper-clipped to a small print of what it answers (D-006). */
export function Reply({ quote, quoteLabel, paper = "plain", onSelectQuote, children }: ReplyProps) {
  return (
    <div className="kasa-reply">
      <button type="button" className={`kasa-object kasa-quote kasa-quote-${paper}`} aria-label={quoteLabel} onClick={onSelectQuote}>
        {quote}
      </button>
      <PaperClip />
      <div className="kasa-reply-object">{children}</div>
    </div>
  );
}

function PaperClip() {
  return (
    <svg className="kasa-clip" width="18" height="46" viewBox="0 0 18 46" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="43" rx="7.5" stroke="currentColor" strokeWidth="3" />
      <rect x="6" y="8" width="6" height="28" rx="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
