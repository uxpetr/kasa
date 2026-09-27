import type { Metadata } from "next";
import { Unsubscribe } from "./unsubscribe";

export const metadata: Metadata = { title: "Emails muted · Kasa", robots: { index: false } };

/**
 * Landing page for the unsubscribe link in every email (D-165, D-167). It mutes from the
 * browser, not on GET, so mail scanners that open links don't mute anyone.
 */
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const { token } = await props.searchParams;
  return <Unsubscribe token={typeof token === "string" ? token : ""} />;
}
