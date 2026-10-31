import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARENA OPS — 3D Tactical Shooter",
  description:
    "Browser-based 3D multiplayer third-person shooter: procedural battleground, authoritative rooms, bots, and a fully customizable touch HUD.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#05080c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="overscroll-none bg-black text-slate-100 antialiased select-none">{children}</body>
    </html>
  );
}
