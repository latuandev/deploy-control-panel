import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deploy Control Panel",
  description: "Private deployment control panel"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

