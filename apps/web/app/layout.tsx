import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { TransitionBanner } from "@/components/transition-banner";
import { CanonicalLink } from "@/components/canonical-link";

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
    default: "Anticipy by Anticipation Labs — An AI that does tasks for you",
    template: "%s | Anticipy by Anticipation Labs",
  },
  description: "Anticipy by Anticipation Labs — a proactive AI employee that books reservations, fills forms, researches topics, and acts before you ask.",
  keywords: ["AI employee", "AI assistant", "task automation", "AGI", "AI intern", "email automation", "Anticipation Labs", "Anticipy"],
  openGraph: {
    title: "Anticipy by Anticipation Labs — An AI that does tasks for you",
    description: "A proactive AI employee that books reservations, fills forms, researches topics, and acts before you ask.",
    url: "https://www.aevoy.com",
    siteName: "Anticipy by Anticipation Labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Anticipy by Anticipation Labs — An AI that does tasks for you",
    description: "A proactive AI employee that acts before you ask.",
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
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Anticipation Labs Inc.",
    url: "https://anticipy.ai",
    sameAs: ["https://www.aevoy.com"],
    brand: [
      { "@type": "Brand", name: "Anticipy" },
      { "@type": "Brand", name: "Aevoy" },
    ],
  };

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <CanonicalLink />
        <TransitionBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
