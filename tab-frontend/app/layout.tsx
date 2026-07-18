import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Stack_Sans_Notch,
  DotGothic16,
} from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const stackSansNotch = Stack_Sans_Notch({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-stack-notch",
});

const dotGothic = DotGothic16({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dot",
});

export const metadata: Metadata = {
  title: "Guitar Whisperer",
  description: "Convert audio to guitar tabs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${stackSansNotch.variable} ${dotGothic.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
