import type { ReactNode } from "react";
import { Fraunces, Instrument_Sans } from "next/font/google";
import "@kasa/ui/styles.css";

// Fonts from the design tokens (D-019), self-hosted by next/font.
const fraunces = Fraunces({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"], variable: "--font-fraunces" });
const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-instrument-sans" });

export const metadata = { title: "Kasa" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${instrumentSans.variable}`}>
      <body className="kasa-table" style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
