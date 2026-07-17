import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: "QANTM Media — Publishing Portal",
  description:
    "Compose, schedule, and publish content across every channel from one calendar.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
