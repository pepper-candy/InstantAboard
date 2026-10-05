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
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
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
    <html lang="zh" data-theme="light" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=JSON.parse(localStorage.getItem("ia.v1.settings")||"null");var t=s&&s.theme;if(t!=="light"&&t!=="dark")t="light";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light"}`,
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
