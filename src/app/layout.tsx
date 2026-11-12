import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavBar } from "@/components/NavBar";
import { Providers } from "@/components/Providers";
import { RegisterSw } from "@/components/RegisterSw";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InstantAboard",
  description: "Personal Hong Kong departure board",
  applicationName: "InstantAboard",
  appleWebApp: { capable: true, title: "InstantAboard", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-512.png", apple: "/apple-touch-icon.png" },
  verification: {
    google: "kIZbdzhCwHIR_owopfDsedSsKn43Ummql-G1cauvLDA",
  },

};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
    { media: "(prefers-color-scheme: light)", color: "#efe8dc" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh" data-theme="dark" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chiron+GoRound+TC:wght@800&text=Instant%20Aboard&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=JSON.parse(localStorage.getItem("ia.v1.settings")||"null");var t=s&&s.theme;if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;var l=s&&s.lang;if(l!=="en"&&l!=="zh")l="zh";document.documentElement.lang=l;document.documentElement.dataset.lang=l;}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.lang="zh";document.documentElement.dataset.lang="zh"}`,
          }}
        />
      </head>
      <body className="min-h-full">
        <Providers>
          {children}
          <NavBar />
        </Providers>
        <RegisterSw />
      </body>
    </html>
  );
}
