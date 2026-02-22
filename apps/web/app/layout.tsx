import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.aevoy.com"),
  title: {
    default: "Aevoy — Your AI Employee",
    template: "%s | Aevoy",
  },
  description: "Email it. It does it. An AI employee that actually does tasks for you — books reservations, fills forms, researches topics, and calls you when something needs attention.",
  keywords: ["AI employee", "AI assistant", "task automation", "AGI", "AI intern", "email automation"],
  openGraph: {
    title: "Aevoy — Your AI Employee",
    description: "Email it. It does it. Not a chatbot. Not an assistant. An employee.",
    url: "https://www.aevoy.com",
    siteName: "Aevoy",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aevoy — Your AI Employee",
    description: "Email it. It does it. Not a chatbot. An employee.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
