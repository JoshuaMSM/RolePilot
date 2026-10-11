import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RolePilot — Your Personal AI Career Agent",
  description: "A focused analytics workspace for your personal job search.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
