"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Today: the time. Yesterday: "Yesterday". This week: the weekday. Older: the date. In the viewer's time zone. */
export function formatRelative(date: Date, now = new Date(), locale?: string): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(locale, { weekday: "short" });
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Renders on the client only, so the server's time zone never shows. */
export function RelativeTime({ iso }: { iso: string }) {
  const onClient = useSyncExternalStore(noop, () => true, () => false);
  return <time dateTime={iso}>{onClient ? formatRelative(new Date(iso)) : null}</time>;
}
