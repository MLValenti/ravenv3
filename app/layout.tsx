import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { EmergencyStopButton } from "@/components/emergency-stop-button";
import { EmergencyStopProvider } from "@/components/emergency-stop-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Raven",
  description: "Raven control panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <EmergencyStopProvider>
          <div className="layout">
            <header className="topbar">
              <nav className="nav">
                <Link href="/">Home</Link>
                <Link href="/camera">Camera</Link>
                <Link href="/session">Session</Link>
                <Link href="/tasks">Tasks</Link>
                <Link href="/review">Review</Link>
                <Link href="/inventory">Inventory</Link>
                <Link href="/avatar">Avatar</Link>
                <Link href="/profile">Profile</Link>
                <Link href="/consent">Consent</Link>
                <Link href="/settings">Settings</Link>
              </nav>
              <EmergencyStopButton />
            </header>
            <main className="content">{children}</main>
          </div>
        </EmergencyStopProvider>
      </body>
    </html>
  );
}
