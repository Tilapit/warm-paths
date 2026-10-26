import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Logo, Nav } from "@/components/Nav";
import { readOwners } from "@/lib/store.ts";
import { loadSignals } from "@/lib/signals.ts";
import { claudeAvailable } from "@/lib/claude.ts";

export const metadata: Metadata = { title: "Warm Paths", description: "Who in your network could help with what you are looking for, and why." };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const owners = readOwners();
  const demo = owners.length > 0 && owners.every((o) => o.demo);
  const signals = loadSignals();
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>
        <header className="top">
          <Link href="/" className="brand">
            <Logo />
            Warm Paths
          </Link>
          <Nav />
        </header>
        {demo ? (
          <div className="demo-banner">
            Demo data: every person here is invented. The companies are real and come from the trade register. <Link href="/settings">Bring in your own networks</Link>
          </div>
        ) : null}
        {children}
        <footer className="foot">
          <span>Data stays on this machine. Only company names go to PRH{claudeAvailable() ? "; one person's role and company facts go to Claude when you open them" : ""}.</span>
          <span>{signals ? `Trade register notices ${signals.start} to ${signals.end}` : "No trade register notices fetched yet"}</span>
          <span>{claudeAvailable() ? "Angles: Claude" : "Angles: templates (no API key)"}</span>
        </footer>
      </body>
    </html>
  );
}
