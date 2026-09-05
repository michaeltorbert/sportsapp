import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saturday Signal | College Football Watchlist",
  description: "Your live college football watchlist. ACC games, one-score games, and Top 25 upset watch, refreshed every 30 seconds.",
  applicationName: "Saturday Signal",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Saturday Signal", statusBarStyle: "black-translucent" },
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
