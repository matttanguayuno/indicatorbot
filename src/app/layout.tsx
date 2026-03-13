import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppNav } from "@/components/app-nav";

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
        {/* PWA loading splash — shown until JS hydrates */}
        <div id="pwa-splash" style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px',
          background: '#030712',
        }}>
          <div style={{
            width: 40, height: 40, border: '3px solid #1e3a5f', borderTopColor: '#3b82f6',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: '#6b7280', fontSize: 14 }}>Loading…</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
        <script dangerouslySetInnerHTML={{ __html: `
          // Remove splash once the page is interactive
          if (document.readyState === 'complete') {
            document.getElementById('pwa-splash')?.remove();
          } else {
            window.addEventListener('load', function() {
              var el = document.getElementById('pwa-splash');
              if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(function() { el.remove(); }, 300); }
            });
          }
        `}} />
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
