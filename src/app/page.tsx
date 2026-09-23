import type { Metadata } from "next";
import TipForm from "@/components/tip/TipForm";
import { db } from "@/lib/db";

/**
 * หน้าเว็บรับโดเนท (ธีมขาว มินิมอล)
 *
 * โครงหน้า: หัวข้อ → ชื่อ → จำนวนเงิน → ข้อความ → ปุ่มจ่ายเงิน (คอลัมน์เดียวกลางหน้า)
 * Logic การจ่ายเงินทั้งหมดอยู่ที่ TipForm + POST /api/tips (ไม่ถูกแก้)
 *
 * ค่าที่ดึงจาก DB (SystemSetting): ยอดขั้นต่ำของเว็บ (minTipAmount) · ความยาวข้อความสูงสุด
 * ถ้าอ่าน DB ไม่ได้ จะใช้ค่าเริ่มต้นแทน เพื่อให้หน้าเว็บเปิดได้เสมอ
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ร่วมสนับสนุน",
  description: "ขอบคุณสำหรับการสนับสนุนของคุณ",
};

/** ยอดขั้นต่ำเริ่มต้น (บาท) — ต้องไม่ต่ำกว่าขั้นต่ำของช่องทางชำระเงิน (Stripe THB = 10) */
const FALLBACK_MIN_AMOUNT = 10;

/** ความยาวข้อความเริ่มต้น (ตัวอักษร) */
const FALLBACK_MAX_MESSAGE_LENGTH = 150;

interface DonateSettings {
  minAmount: number;
  maxMessageLength: number;
}

async function loadDonateSettings(): Promise<DonateSettings> {
  try {
    const settings = await db.systemSetting.findUnique({ where: { id: "default" } });

    return {
      minAmount: Math.max(1, settings ? Number(settings.minTipAmount) : FALLBACK_MIN_AMOUNT),
      maxMessageLength: settings?.maxMessageLength ?? FALLBACK_MAX_MESSAGE_LENGTH,
    };
  } catch (err) {
    // หน้าเว็บต้องเปิดได้เสมอแม้ DB จะล่ม — ผู้ชมยังเห็นฟอร์มและอ่านข้อผิดพลาดได้ชัดเจน
    console.error("[donate] อ่านค่า settings จาก DB ไม่ได้ ใช้ค่าเริ่มต้นแทน:", err);

    return { minAmount: FALLBACK_MIN_AMOUNT, maxMessageLength: FALLBACK_MAX_MESSAGE_LENGTH };
  }
}

export default async function Home() {
  const { minAmount, maxMessageLength } = await loadDonateSettings();

  return (
    <main className="flex min-h-dvh justify-center bg-white px-5 py-14 sm:px-6 sm:py-20">
      <div className="w-full max-w-[520px]">
        <header className="text-center">
          <h1 className="text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">ร่วมสนับสนุน</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            ขอบคุณสำหรับการสนับสนุนของคุณ
          </p>
        </header>

        <div className="donate-card mt-8 rounded-2xl p-6 sm:mt-10 sm:p-8">
          <TipForm
            minAmount={minAmount}
            currency={process.env.DEFAULT_CURRENCY ?? "THB"}
            maxMessageLength={maxMessageLength}
          />
        </div>
      </div>
    </main>
  );
}
