import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppNav } from "@/components/app-nav";
import { SplashRemover } from "@/components/splash-remover";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Indicator Bot",
  description: "AI Trading Signal Scanner",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Indicator Bot",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#030712" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-gray-100 min-h-screen`}
      >
        {/* PWA loading splash — CSS-only, hidden by SplashRemover client component */}
        <div id="pwa-splash" className="fixed inset-0 z-[9999] flex items-center justify-center flex-col gap-4 bg-[#030712]">
          <div className="w-10 h-10 border-[3px] border-[#1e3a5f] border-t-blue-500 rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading…</span>
        </div>
        <SplashRemover />
        <div className="flex min-h-screen">
          <AppNav />
          <main className="flex-1 pb-24 lg:pb-4 px-4 lg:px-8 xl:px-12 w-full">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
