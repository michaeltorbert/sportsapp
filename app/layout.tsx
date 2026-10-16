import type { Metadata, Viewport } from "next";
import "./globals.css";
import { EARLY_POPSTATE_SCRIPT } from "@/lib/game-route";

export const metadata: Metadata = {
  title: "Saturday Signal Scores | College Football Watchlist",
  description: "Your live college football watchlist. ACC games, one-score games, and Top 25 upset watch, refreshed every 30 seconds.",
  // Install name only (#112), matching the manifest; the in-app wordmark stays "Saturday Signal".
  applicationName: "Saturday Signal Scores",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Saturday Signal Scores", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};
// This Vinext release omits viewportFit when serializing the viewport.
// Including the directive here produces one correct viewport meta element.
export const viewport: Viewport = { width: "device-width, viewport-fit=cover", initialScale: 1, viewportFit: "cover", themeColor: "#0a0e16" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* First in the body, so it parses before the framework's entry script on every route (Scores and
          Guide). Inert by itself: it only forwards history traversals to the mounted Scores page, which
          handles one only when both entries are its own validated root entries. See lib/game-route.ts. */}
      <body className="antialiased"><script dangerouslySetInnerHTML={{ __html: EARLY_POPSTATE_SCRIPT }} />{children}</body>
    </html>
  );
}
