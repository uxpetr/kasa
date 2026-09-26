import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BotButton, BotCard, CategoryStamp, LinedSheet, Polaroid, Print, Sticky } from "@kasa/ui";
import { InteractiveSamples } from "./interactive";
import styles from "./design.module.css";

export const metadata: Metadata = { title: "Kasa components" };

// Every physical-object component on one page, laid out like design/prototype/ContentTypes.dc.html (F-08).
export default function DesignPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>What lands in the pile</h1>
        <p>Every Kasa component, drawn from the design tokens.</p>
      </header>

      <div className={styles.grid}>
        <Sample title="Note" what="Sticky for short text; a lined sheet once it gets long.">
          <Sticky rotate={-2}>Last night in Kyoto: somewhere with an onsen?</Sticky>
          <LinedSheet rotate={2}>
            Long notes land on lined paper instead, so a sticky never overflows. Tap to read the rest, including the part
            about the ryokan with the private onsen.
          </LinedSheet>
        </Sample>

        <Sample title="Photo" what="A polaroid with the caption on the bottom strip; stacks show a count.">
          <Polaroid src="/samples/kinkakuji.jpg" alt="Kinkaku-ji, the golden pavilion" caption="Pond at 8am" rotate={-2.5} />
          <Polaroid src="/samples/osaka-castle.jpg" alt="Osaka Castle" rotate={2.5} moreCount={4} imageHeight={150} />
        </Sample>

        <Sample title="Capture" what="A taped-down print of the page with numbered pins.">
          <Print
            src="/samples/tokyo-fuji.jpg"
            alt="Tokyo Tower in front of Mount Fuji"
            rotate={1}
            pins={[{ number: 1, x: 0.42, y: 0.45 }]}
          >
            <strong className={styles.pinNumber}>1</strong> Go at sunset? <span className={styles.muted}>· 2 replies</span>
            <div className={styles.muted}>from example.com · Open original</div>
          </Print>
        </Sample>

        <Sample title="Drawing" what="The same print with the ink layer on top.">
          <Print
            src="/samples/higashiyama.jpg"
            alt="A lane in Higashiyama, Kyoto"
            rotate={-1}
            tape={false}
            imageHeight={170}
            overlay={
              <svg viewBox="0 0 314 170" className={styles.ink} aria-hidden="true">
                <path d="M150 40 C 200 30, 250 50, 250 90 C 250 130, 190 140, 160 125 C 120 108, 118 60, 156 42" />
                <path d="M40 150 C 70 140, 100 130, 130 115" />
                <path d="M118 112 L 132 114 L 126 127" />
              </svg>
            }
          >
            <strong>“that tree!”</strong>
          </Print>
        </Sample>

        <Sample title="Kasa Bot" what="A pine index card with the k mark. Tips always have “Not now”.">
          <BotCard
            rotate={-1}
            actions={
              <>
                <BotButton>Yes, suggest</BotButton>
                <BotButton variant="secondary">Not now</BotButton>
              </>
            }
          >
            Kinkaku-ji and Kiyomizu-dera are on opposite sides of Kyoto. Split them across days?
          </BotCard>
          <BotCard rotate={1.5}>
            Sorted 3 new things into <strong>Sights</strong>.
          </BotCard>
        </Sample>

        <Sample title="Category stamp" what="Small green stamps in the meta line.">
          <div className={styles.meta}>
            <strong>Aiko</strong> · 18:02 <CategoryStamp>Plans</CategoryStamp>
          </div>
          <div className={styles.meta}>
            <strong>Mika</strong> · 09:30 · via Telegram <CategoryStamp>Tokyo</CategoryStamp>
          </div>
        </Sample>
      </div>

      <InteractiveSamples />
    </main>
  );
}

function Sample({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  return (
    <article className={styles.sample}>
      <div className={styles.stage}>{children}</div>
      <h2>{title}</h2>
      <p>{what}</p>
    </article>
  );
}
