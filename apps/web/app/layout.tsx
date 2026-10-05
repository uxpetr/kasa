import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { tokens } from "@kasa/ui";
import "@kasa/ui/styles.css";

// Fonts from the design tokens (D-019), self-hosted by next/font.
const fraunces = Fraunces({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"], variable: "--font-fraunces" });
const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-instrument-sans" });

export const metadata: Metadata = {
  title: "Kasa",
  // Added to the iPhone home screen (P-22): full screen, named Kasa, with the system status bar.
  appleWebApp: { capable: true, title: "Kasa", statusBarStyle: "default" },
};

// viewport-fit=cover lets pages use the whole screen; they keep clear of the notch and the home
// bar with env(safe-area-inset-*).
export const viewport: Viewport = { themeColor: tokens.color.table, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${instrumentSans.variable}`}>
      <body className="kasa-table" style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
