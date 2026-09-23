import type { Metadata } from "next";
import { redirect } from "next/navigation";
import VoiceOnlyClient from "@/components/overlay/VoiceOnlyClient";
import { isOverlayToken, normalizeOverlayToken } from "@/lib/overlay-token";

export const metadata: Metadata = {
  title: "Stream Voice (อ่านเสียงเท่านั้น)",
};

interface VoicePageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * หน้า "อ่านเสียงเท่านั้น" — เปิดใน Edge คู่กับ OBS
 * URL: http://localhost:3300/overlay/voice?token=YOUR_OVERLAY_TOKEN
 *
 * ใช้เมื่อ Browser Source ของ OBS (CEF) ไม่มีเสียงไทยผู้หญิง แต่ Edge มี
 * (`Microsoft เปรมวดี Online (Natural)`) → ให้ Edge เป็นคนอ่านเสียงเพียงตัวเดียว
 * โดยตั้ง Browser Source หลักให้มี `?tts=0` เพื่อไม่ให้อ่านซ้ำสองเสียง
 *
 * ตรวจ token ฝั่ง Server เหมือนหน้า overlay หลัก (ไม่ส่ง token จริงลง client bundle)
 */
export default async function OverlayVoicePage({ searchParams }: VoicePageProps) {
  const { token } = await searchParams;

  if (!isOverlayToken(token ?? null, process.env.OVERLAY_TOKEN)) {
    redirect("/");
  }

  return <VoiceOnlyClient token={normalizeOverlayToken(token as string)} />;
}
