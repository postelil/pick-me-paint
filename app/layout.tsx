import type { Metadata } from "next";
import { Comic_Neue } from "next/font/google";
import "./globals.css";

const comicNeue = Comic_Neue({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-comic-neue"
});

export const metadata: Metadata = {
  title: "Pick Me Paint",
  description: "Upload image and generate clumsy MS Paint style meme art."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={comicNeue.variable}>{children}</body>
    </html>
  );
}
