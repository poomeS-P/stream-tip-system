import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

/**
 * ฟอนต์หลักของเว็บ — Noto Sans Thai (variable font, subset ไทย)
 * self-host ผ่าน next/font/google → เบราว์เซอร์ไม่ยิง request ไป Google เอง
 */
const notoSansThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ร่วมสนับสนุน",
  description: "ขอบคุณสำหรับการสนับสนุนของคุณ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
