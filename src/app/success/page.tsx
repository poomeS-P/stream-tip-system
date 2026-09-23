import Link from "next/link";
import { db } from "@/lib/db";

/**
 * หน้านี้เป็นเพียงหน้า "แจ้งสถานะ" ให้ผู้ชม — ไม่ใช่หลักฐานการชำระเงิน
 *
 * กฎสำคัญ:
 * - ห้าม mark PaymentTransaction เป็น SUCCESS จากหน้านี้
 * - ห้ามเชื่อ session_id ที่มาจาก browser ว่าเป็นการจ่ายสำเร็จ
 *   (ใช้ session_id ได้แค่ "อ่าน" สถานะจาก DB ของเรา ซึ่งถูกอัปเดตโดย verified Stripe webhook เท่านั้น)
 */

export const dynamic = "force-dynamic";

interface SuccessPageProps {
  searchParams: Promise<{ session_id?: string }>;
}

type PaymentDisplayState = "CONFIRMED" | "PENDING" | "FAILED" | "UNKNOWN";

/** อ่านสถานะจาก DB ของเราเท่านั้น (ไม่เรียก Stripe และไม่แก้ข้อมูลใด ๆ) */
async function resolveDisplayState(sessionId: string | undefined): Promise<PaymentDisplayState> {
  if (!sessionId) return "UNKNOWN";

  try {
    const payment = await db.paymentTransaction.findUnique({
      where: { providerTxId: sessionId },
      select: { status: true },
    });

    if (!payment) return "UNKNOWN";

    switch (payment.status) {
      case "SUCCESS":
        return "CONFIRMED";
      case "PENDING":
        return "PENDING";
      case "FAILED":
      case "EXPIRED":
        return "FAILED";
      default:
        return "UNKNOWN";
    }
  } catch {
    // DB ไม่พร้อมใช้งาน → แสดงข้อความกลาง ๆ (ไม่ยืนยันการจ่าย)
    return "UNKNOWN";
  }
}

const DISPLAY: Record<PaymentDisplayState, { emoji: string; title: string; detail: string }> = {
  CONFIRMED: {
    emoji: "🎉",
    title: "ยืนยันการชำระเงินแล้ว!",
    detail:
      "Stripe ยืนยันการชำระเงินเรียบร้อยแล้ว ข้อความของคุณอยู่ในคิว จะปรากฏบน Stream เร็วๆ นี้ 💜",
  },
  PENDING: {
    emoji: "⏳",
    title: "ได้รับคำขอชำระเงินแล้ว",
    detail:
      "กำลังรอการยืนยันจาก Stripe (PromptPay ต้องรอระบบธนาคารยืนยัน) — เมื่อยืนยันสำเร็จ ข้อความของคุณจะเข้าคิวและขึ้นบน Stream อัตโนมัติ กรุณารีเฟรชหน้านี้เพื่อดูสถานะล่าสุด",
  },
  FAILED: {
    emoji: "⚠️",
    title: "การชำระเงินไม่สำเร็จ",
    detail:
      "รายการนี้ถูกยกเลิกหรือหมดเวลาโดยยังไม่ได้รับการยืนยันการจ่าย จึงยังไม่มีทิปถูกบันทึก คุณสามารถลองส่งใหม่อีกครั้งได้",
  },
  UNKNOWN: {
    emoji: "⏳",
    title: "ได้รับคำขอชำระเงินแล้ว",
    detail:
      "สถานะจะอัปเดตหลังระบบได้รับการยืนยันการชำระเงินจาก Stripe เท่านั้น กรุณารีเฟรชหน้านี้เพื่อดูสถานะล่าสุด",
  },
};

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const { session_id: sessionId } = await searchParams;
  const state = await resolveDisplayState(sessionId);
  const view = DISPLAY[state];

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="text-6xl mb-4">{view.emoji}</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{view.title}</h1>
        <p className="text-gray-500 mb-6">{view.detail}</p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition"
        >
          ส่งทิปอีกครั้ง
        </Link>
      </div>
    </main>
  );
}

