import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { redirect } from "next/navigation";
import PodiumClient from "@/components/overlay/PodiumClient";
import { isOverlayToken, normalizeOverlayToken } from "@/lib/overlay-token";
import { getTopDonors } from "@/lib/top-donors";

/**
 * ฟอนต์ของการ์ด Top Donate — **ชุดเดียวกับการ์ด Last Follow ของระบบเดิมเป๊ะ**
 * (ระบบเดิมโหลด Montserrat:wght@300;500;600 จาก Google Fonts · ที่นี่ self-host ผ่าน next/font
 *  -> เบราว์เซอร์ของ OBS ไม่ต้องยิง request ไป Google ตอนเล่น และน้ำหนักที่โหลดตรงกัน 3 ตัว)
 * ตัวไทยยังใช้ Noto Sans Thai ที่โหลดไว้แล้วใน layout (แถว fallback ต่อท้าย)
 */
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "500", "600"],
  display: "swap",
});

/**
 * Top Donate Podium Page
 * URL: /podium?token=OVERLAY_TOKEN[&podiumdiag=1&podiumwidthpx=...]
 *
 * - ตรวจ token ฝั่ง server เหมือน /overlay และ /overlay/voice
 * - SSR ข้อมูล Top-3 ชุดแรก → เปิดมาเห็นทันที (ไม่กระพริบ) แล้ว client จะ sync ต่อผ่าน API + SSE (role=passive)
 * - พื้นหลังโปร่งใสสำหรับ OBS Browser Source
 */
export const metadata: Metadata = {
  title: "Top Donate Podium",
};

export const dynamic = "force-dynamic";

interface PodiumPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function PodiumPage({ searchParams }: PodiumPageProps) {
  const { token } = await searchParams;

  if (!isOverlayToken(token ?? null, process.env.OVERLAY_TOKEN)) {
    redirect("/");
  }

  const initial = await getTopDonors({
    limit: 3,
    currency: process.env.DEFAULT_CURRENCY ?? "THB",
  }).catch((error: unknown) => {
    // DB สะดุดชั่วคราวต้องไม่ทำให้หน้า Podium ล่ม — client จะลอง sync เองอีกครั้ง
    console.error("[podium] อ่าน Top Donors ไม่สำเร็จ:", error);
    return null;
  });

  return (
    <>
      {/* OBS Browser Source ต้องโปร่งใส ไม่มี margin/scrollbar */}
      <style>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: transparent;
          overflow: hidden;
        }
      `}</style>
      {/* ครอบด้วยคลาสของ next/font (สร้าง CSS var --font-montserrat ให้ลูกทั้งหมด)
          -> ตัวอักษรในตารางใช้ฟอนต์ชุดเดียวกับการ์ด Last Follow · div ธรรมดาไม่กระทบ position: fixed ของการ์ด */}
      <div className={montserrat.variable}>
        <PodiumClient token={normalizeOverlayToken(token as string)} initial={initial} />
      </div>
    </>
  );
}
