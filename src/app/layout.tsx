import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Flame } from "lucide-react";
import { RepoInput } from "@/components/RepoInput";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ghflare",
    template: "%s — ghflare",
  },
  description: "Detect anomalous issue activity in GitHub Trending repos",
  openGraph: {
    title: "ghflare",
    description: "Detect anomalous issue activity in GitHub Trending repos",
    siteName: "ghflare",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ghflare",
    description: "Detect anomalous issue activity in GitHub Trending repos",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text-primary">
        <header className="sticky top-0 z-50 bg-surface border-b border-border">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center group-hover:opacity-90 transition-opacity">
                <Flame className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-serif text-lg font-semibold text-text-primary leading-none">
                  ghflare
                </span>
                <span className="text-xs text-text-muted leading-none">
                  GitHub Issue Monitoring
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-4">
              <RepoInput />
              <a
                href="https://github.com/IMMINJU/ghflare"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-text-muted hover:text-text-secondary transition-colors"
              >
                GitHub ↗
              </a>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-border mt-16 py-8">
          <div className="max-w-4xl mx-auto px-6 text-center text-sm text-text-muted">
            ghflare monitors GitHub Trending repositories for unusual issue
            activity
          </div>
        </footer>
      </body>
    </html>
  );
}
