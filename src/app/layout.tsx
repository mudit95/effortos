import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { ConsentBanner } from "@/components/legal/ConsentBanner";
import "./globals.css";

// Used for resolving relative OpenGraph URLs (the opengraph-image.tsx file
// next to this layout will be rendered at /opengraph-image and referenced
// here automatically). Set NEXT_PUBLIC_SITE_URL in production; defaults to
// the Vercel preview URL or localhost otherwise.
const siteUrl = (() => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
})();

const TAGLINE = "A focus app that adapts when your day falls apart";
const SHORT_DESC =
  "Plan less. Carry forward in three taps. Reply \"1\" on WhatsApp to mark a task done. Built for UPSC, CA, and indie founders.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `EffortOS — ${TAGLINE}`,
    template: "%s — EffortOS",
  },
  description: SHORT_DESC,
  applicationName: "EffortOS",
  keywords: [
    "focus app",
    "pomodoro",
    "productivity",
    "WhatsApp productivity",
    "UPSC prep",
    "India productivity",
    "task tracker",
    "daily planner",
  ],
  authors: [{ name: "EffortOS" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EffortOS",
  },
  icons: {
    icon: "/icon-192.svg",
    apple: "/icon-192.svg",
  },
  openGraph: {
    type: "website",
    siteName: "EffortOS",
    title: `EffortOS — ${TAGLINE}`,
    description: SHORT_DESC,
    url: siteUrl,
    locale: "en_IN",
    // The opengraph-image.tsx alongside this layout becomes the default OG
    // image automatically — Next.js wires it up. We don't need to declare
    // images: [...] explicitly unless we want to override.
  },
  twitter: {
    card: "summary_large_image",
    title: `EffortOS — ${TAGLINE}`,
    description: SHORT_DESC,
    creator: "@effortos",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0F14",
  width: "device-width",
  initialScale: 1,
  // Intentionally NOT setting maximumScale — pinning to 1 blocks pinch-zoom,
  // which is a WCAG 1.4.4 accessibility violation (low-vision users need
  // to be able to zoom). Default `maximumScale` of 10 is correct.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="bg-[#0B0F14] text-white font-sans">
        {children}
        {/* DPDP / GDPR consent banner — first-visit only, decision durable
            via localStorage snapshot + consent_log row on the server. See
            src/components/legal/ConsentBanner.tsx for the full flow. */}
        <ConsentBanner />
        {/*
          Razorpay checkout.js — lazy-loaded so it doesn't block first paint.
          Earlier this was a plain `async` <script> in layout, which fetched
          ~30 KB on every page (landing, signin, legal pages — none of which
          ever open a checkout). next/script with strategy="lazyOnload"
          defers loading until after the page is idle, while still making
          window.Razorpay available before a user can realistically click
          Subscribe. We poll for window.Razorpay in useStore.startTrial as a
          belt-and-braces against very-fast clickers.
        */}
        <Script
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
