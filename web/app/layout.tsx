import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DataProvider } from "@/lib/context/DataContext";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PharmacoVigil AI — AI & ML in Pharmacovigilance",
  description:
    "Browser-based FAERS-style signal detection, Bayesian screens, ML prioritisation, and narrative NLP for day-to-day pharmacovigilance workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${fraunces.variable} font-sans`}>
        <ThemeProvider>
          <DataProvider>
            <AppShell>{children}</AppShell>
          </DataProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
