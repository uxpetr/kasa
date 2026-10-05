"use client";

import { useEffect, useRef, useState } from "react";
import { VIEWS } from "./registry";
import styles from "./views.module.css";

const DEVICES = {
  phone: { label: "Phone", width: 390, height: 844 },
  desktop: { label: "Desktop", width: 1280, height: 820 },
} as const;
type Device = keyof typeof DEVICES;
type Mode = Device | "both";
const MODES: { id: Mode; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "phone", label: "Phone" },
  { id: "desktop", label: "Desktop" },
];

const fromHash = () => {
  const id = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return VIEWS.some((v) => v.id === id) ? id : VIEWS[0]!.id;
};

/** The views preview (F-19): pick a view, see it framed at phone and desktop width. */
export function Gallery() {
  const [current, setCurrent] = useState(VIEWS[0]!.id);
  const [mode, setMode] = useState<Mode>("both");
  // Bumped by Reload, so the frames load the view again with fresh styles and data.
  const [round, setRound] = useState(0);

  useEffect(() => {
    const sync = () => setCurrent(fromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const view = VIEWS.find((v) => v.id === current)!;
  const src = `/design/views/${view.id}`;
  const devices: Device[] = mode === "both" ? ["phone", "desktop"] : [mode];

  return (
    <div className={styles.layout}>
      <nav aria-label="Views" className={styles.nav}>
        <ul>
          {VIEWS.map((v) => (
            <li key={v.id}>
              <a href={`#${v.id}`} aria-current={v.id === current ? "page" : undefined}>
                {v.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section className={styles.main} aria-labelledby="view-title">
        <div className={styles.toolbar}>
          <div>
            <h2 id="view-title">{view.title}</h2>
            <p>
              {view.note} <span className={styles.design}>Design: {view.design}</span>
            </p>
          </div>
          <div className={styles.controls}>
            <div role="group" aria-label="Width" className={styles.segmented}>
              {MODES.map((m) => (
                <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.action} onClick={() => setRound((r) => r + 1)}>
              Reload
            </button>
            <a className={styles.action} href={src} target="_blank" rel="noopener">
              Open on its own
            </a>
          </div>
        </div>

        <div className={styles.frames} data-mode={mode}>
          {devices.map((d) => (
            <Frame key={`${d}-${view.id}-${round}`} device={d} src={src} title={`${view.title}, ${DEVICES[d].label.toLowerCase()}`} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** One device-sized frame, scaled down to fit when there's less room than the device is wide. */
function Frame({ device, src, title }: { device: Device; src: string; title: string }) {
  const { width, height, label } = DEVICES[device];
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => setScale(Math.min(1, (e?.contentRect.width ?? width) / width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <figure className={styles.frame} data-device={device}>
      <figcaption>
        {label} · {width}px{scale < 1 ? ` at ${Math.round(scale * 100)}%` : ""}
      </figcaption>
      <div ref={box} className={styles.screenBox} style={{ maxWidth: width, height: height * scale }}>
        <iframe
          src={src}
          title={title}
          className={styles.screen}
          style={{ width, height, transform: `scale(${scale})` }}
        />
      </div>
    </figure>
  );
}
