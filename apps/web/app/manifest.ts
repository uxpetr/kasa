import type { MetadataRoute } from "next";
import { tokens } from "@kasa/ui";

/** Kasa on the home screen (P-22, D-211): opens Your piles full screen, in the table colour. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kasa",
    short_name: "Kasa",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: tokens.color.table,
    theme_color: tokens.color.table,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // The "k" sits inside the safe zone, so the same image works when it's cropped to a shape.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
