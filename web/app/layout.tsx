import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { PresentationProvider } from "@/components/PresentationProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { PresentationBar } from "@/components/PresentationBar";
import { ThemeProvider } from "@/components/ThemeProvider";

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
  title: "PharmacoVigil AI — AI & Machine Learning in Pharmacovigilance",
  description:
    "Live seminar demo: FAERS-style signal detection, disproportionality, Bayesian methods, and ML prioritisation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${fraunces.variable} font-sans`}>
        <ThemeProvider>
          <PresentationProvider>
            <SiteHeader />
            <PresentationBar />
            <main>{children}</main>
          </PresentationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
