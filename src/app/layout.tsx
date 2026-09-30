import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { PAGE } from "./copy";
import "./globals.css";

// Two weights at most (brand direction).
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"], display: "swap" });

export const metadata: Metadata = {
  title: PAGE.title,
  description: PAGE.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
