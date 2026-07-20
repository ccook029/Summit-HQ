import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { CommandPalette, CommandButton } from "@/components/command-palette";
import { Confetti } from "@/components/confetti";
import { RunPipelineProvider } from "@/components/run-pipeline";
import DepartmentsMenu from "@/components/departments-menu";
import SignOut from "@/components/sign-out";
import OwnerNav from "@/components/owner-nav";
import { SummitMark } from "@/components/logo";

const SITE_URL = "https://summit-hq.vercel.app";
const OG_DESCRIPTION =
  "AI-powered corporate headquarters for Summit Equipment — an AI staff running finance, operations, and business development under the owner's review.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Summit Equipment HQ",
    template: "%s · Summit HQ",
  },
  description: OG_DESCRIPTION,
  applicationName: "Summit HQ",
  openGraph: {
    title: "Summit Equipment HQ",
    description: OG_DESCRIPTION,
    url: SITE_URL,
    siteName: "Summit HQ",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#163e6c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-paper text-slate-900 min-h-screen">
        {/* Animated aurora backdrop */}
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="aurora absolute inset-[-12%]" />
        </div>
        <ToastProvider>
        <RunPipelineProvider>
        <header className="border-b border-line px-4 sm:px-6 py-4 sm:py-6 bg-paper/90 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Link href="/" className="flex items-center gap-3 group shrink-0">
              <SummitMark className="h-9 w-auto" />
              <span className="font-display text-2xl sm:text-3xl font-bold uppercase tracking-[0.18em] text-navy">
                Summit
              </span>
              <span className="hidden sm:inline text-base text-slate-500 border-l border-line pl-4 group-hover:text-skydeep transition-colors">
                Headquarters
              </span>
            </Link>
            {/* The bar reads like the company: the org, its departments (each
                with its tools inside), then the owner's desk, then utilities. */}
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <CommandButton />
              <Link
                href="/org"
                className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Org Chart
              </Link>
              <DepartmentsMenu />
              <span className="hidden sm:inline text-xs text-slate-400">|</span>
              <OwnerNav />
              <span className="hidden sm:inline text-xs text-slate-400">|</span>
              <Link
                href="/dashboard"
                className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Operations
              </Link>
              <Link
                href="/knowledge"
                className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Knowledge
              </Link>
              <SignOut />
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 relative z-10">
          {children}
        </main>
        <CommandPalette />
        <Confetti />
        </RunPipelineProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
