"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EMPTY_PILE_ID, MY_PILE_ID } from "./fixture-ids";

/** The service worker that answers the views' /api requests from sample data (F-19). */
export const PREVIEW_WORKER = "/design-views-sw.js";
const SCOPE = "/design/";

/** Resolves once this page's requests go through the preview worker. */
export async function previewReady(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;
  await navigator.serviceWorker.register(PREVIEW_WORKER, { scope: SCOPE });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return true;
  // The worker claims open pages when it activates.
  await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  return true;
}

/** Where an app link goes in the preview: the matching view, or nowhere. */
function previewHref(path: string): string | null {
  if (path === "/") return "/design/views/piles";
  const pile = /^\/projects\/([^/]+)/.exec(path)?.[1];
  if (pile === MY_PILE_ID) return "/design/views/first-run";
  if (pile === EMPTY_PILE_ID) return "/design/views/empty";
  if (pile) return "/design/views/feed";
  return null;
}

/**
 * Shows its view only once the preview worker is in charge, so no request from the view reaches
 * the real API. Links into the app stay inside the preview.
 */
export function PreviewGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"waiting" | "ready" | "unsupported">("waiting");

  useEffect(() => {
    let live = true;
    void previewReady()
      .then((ok) => live && setState(ok ? "ready" : "unsupported"))
      .catch(() => live && setState("unsupported"));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.origin !== window.location.origin || a.pathname.startsWith("/design/")) return;
      e.preventDefault();
      const to = previewHref(a.pathname);
      if (to) window.location.assign(to);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (state === "unsupported") return <p style={{ padding: 24 }}>This preview needs a browser with service workers.</p>;
  return state === "ready" ? children : null;
}
