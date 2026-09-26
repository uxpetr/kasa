"use client";

import { useState } from "react";
import { CategoryChip, Composer, Print } from "@kasa/ui";
import styles from "./design.module.css";

const chips = [
  { label: "All", count: 8 },
  { label: "Sights", count: 3 },
  { label: "Tokyo", count: 2 },
  { label: "Plans", count: 2 },
];

/** The components that respond to input: filter chips, pins, and the composer. */
export function InteractiveSamples() {
  const [filter, setFilter] = useState("All");
  const [openPin, setOpenPin] = useState<number | undefined>();
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<string[]>([]);

  return (
    <section className={styles.interactive} aria-label="Interactive components">
      <div>
        <h2>Filter chips</h2>
        <div className={styles.chips} role="group" aria-label="Categories">
          {chips.map((c) => (
            <CategoryChip key={c.label} label={c.label} count={c.count} pressed={filter === c.label} onToggle={() => setFilter(c.label)} />
          ))}
        </div>
      </div>

      <div>
        <h2>Pins</h2>
        <Print
          src="/samples/tokyo-fuji.jpg"
          alt="Tokyo Tower in front of Mount Fuji"
          rotate={0.5}
          pins={[
            { number: 1, x: 0.42, y: 0.45 },
            { number: 2, x: 0.72, y: 0.28 },
          ]}
          openPin={openPin}
          onSelectPin={(n) => setOpenPin(openPin === n ? undefined : n)}
        >
          {openPin ? `Thread for pin ${openPin} is open` : "Select a pin to open its thread"}
        </Print>
      </div>

      <div className={styles.composerRow}>
        <h2>Composer</h2>
        <Composer
          label="Add to Japan 2027"
          placeholder="Paste a link, drop a photo, write a note, or ask @kasa"
          value={draft}
          onChange={setDraft}
          onSubmit={(text) => {
            setSent([...sent, text]);
            setDraft("");
          }}
          onAttach={() => {}}
        />
        <ul className={styles.sent} aria-label="Sent notes">
          {sent.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
