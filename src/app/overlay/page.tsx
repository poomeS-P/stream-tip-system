import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OverlayClient from "@/components/overlay/OverlayClient";

// Title สำหรับหน้า Overlay (แทน <title> ที่เคยอยู่ใน nested <head>)
export const metadata: Metadata = {
  title: "Stream Overlay",
};

interface OverlayPageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * OBS Browser Source Page
 * URL: http://localhost:3300/overlay?token=YOUR_OVERLAY_TOKEN
 *
 * ต้องใส่ token ใน URL เพื่อให้ OBS Browser Source เชื่อมต่อได้
 * ตั้งค่าพื้นหลังเป็น Transparent ใน OBS Browser Source settings
 */
export default async function OverlayPage({ searchParams }: OverlayPageProps) {
  const { token } = await searchParams;

  // ตรวจสอบ token ฝั่ง Server ก่อน render
  // ป้องกัน token โดนเห็นใน client bundle
  const expectedToken = process.env.OVERLAY_TOKEN;
  if (!token || !expectedToken || token !== expectedToken) {
    redirect("/");
  }

  // ห้าม render <html>/<body> ซ้อนกับ root layout (src/app/layout.tsx)
  // ใช้ Fragment + <style> เพื่อคงหน้าตาเดิมของ OBS Browser Source
  return (
    <>
      {/* OBS Browser Source ต้องโปร่งใส ไม่มี margin และไม่มี scrollbar */}
      <style>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: transparent;
          overflow: hidden;
        }
      `}</style>
      {/* ส่ง token ที่ผ่านการตรวจสอบแล้วไปให้ Client Component */}
      <OverlayClient token={token} />
    </>
  );
}
