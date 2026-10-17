import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospecting Engine",
  description: "AI-assisted prospect research and qualification",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
