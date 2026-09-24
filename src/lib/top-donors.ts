import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * คำนวณ "ผู้สนับสนุนยอดสะสมสูงสุด" (Top Donors) จากข้อมูลที่มีอยู่แล้ว
 *
 * กติกาสำคัญ:
 *  1) นับเฉพาะรายการที่ "จ่ายสำเร็จ" (PaymentTransaction.status = SUCCESS)
 *     → ตัด PENDING/FAILED/EXPIRED และตัด Test Alert (ไม่มี PaymentTransaction) ให้เอง
 *  2) โหมดค่าเริ่มต้น "live" = เฉพาะรายการที่จ่ายจริงบน Stripe Live
 *     (providerTxId ขึ้นต้นด้วย "cs_live_") → **ไม่มียอดทดสอบรวม** (cs_test_* / cs_test_e2e_*)
 *  3) รวมยอดต่อ "คนเดียวกัน" ด้วย Tip.rawDonorName (ยอดสะสมทุกครั้ง)
 *  4) ผู้ที่เลือก "ไม่ระบุตัวตน" (isAnonymous) ถูกบันทึก rawDonorName = "anonymous"
 *     → ทุกครั้งรวมเป็นก้อนเดียว และแสดงเป็น "ไม่ระบุชื่อ" เท่านั้น (ห้ามเปิดเผยชื่อจริง)
 *  5) เรียงมาก → น้อย · คะแนนเท่ากันให้คนที่จ่ายก่อนอยู่ก่อน (MIN(paidAt)) เพื่อผลลัพธ์คงที่
 *
 * ใช้กับ: GET /api/overlay/top-donors และ scripts/top-donors-preview.ts (สูตรเดียว ไม่ซ้ำ)
 */

/** โหมดนับยอด: "live" = ยอดจริงเท่านั้น · "all" = รวมยอดทดสอบ (สำหรับ dev/ทดสอบ UI เท่านั้น) */
export type TopDonorMode = "live" | "all";

/** Checkout Session ของโหมดจริงขึ้นต้นด้วยค่านี้ (แยกจาก cs_test_ / cs_test_e2e_) */
const LIVE_PREFIX = "cs_live_";

/** ชื่อที่ใช้แสดงแทนผู้บริจาคที่เลือกไม่ระบุตัวตน */
export const ANONYMOUS_DISPLAY_NAME = "ไม่ระบุชื่อ";

export interface TopDonor {
  rank: number;
  /** ชื่อที่ปลอดภัยต่อการแสดงผล (匿名 → "ไม่ระบุชื่อ") */
  displayName: string;
  total: number;
  donationCount: number;
  anonymous: boolean;
}

export interface TopDonorsResult {
  mode: TopDonorMode;
  currency: string;
  generatedAt: string;
  donors: TopDonor[];
}

export interface TopDonorsOptions {
  /** จำนวนอันดับที่ต้องการ (1-10 · ค่าเริ่มต้น 3) */
  limit?: number;
  /** โหมดนับยอด (ค่าเริ่มต้น "live" = ยอดจริงเท่านั้น) */
  mode?: TopDonorMode;
  /** สกุลเงินที่ใช้นับ (ค่าเริ่มต้น THB) */
  currency?: string;
}

interface TopDonorRow {
  name: string;
  total: Prisma.Decimal | number | string;
  donation_count: bigint | number;
  anonymous: boolean;
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value as number)));
}

export async function getTopDonors(options: TopDonorsOptions = {}): Promise<TopDonorsResult> {
  const limit = normalizeLimit(options.limit);
  const mode: TopDonorMode = options.mode === "all" ? "all" : "live";
  const currency = (options.currency ?? "THB").toUpperCase();

  // โหมด live: เฉพาะ Checkout Session ของโหมดจริง
  // ใช้ starts_with() (Postgres 11+) แทน LIKE เพราะ "_" ใน LIKE เป็น wildcard และแทน left() ที่ชนกับ bigint
  const liveFilter =
    mode === "live"
      ? Prisma.sql`AND starts_with(p."providerTxId", ${LIVE_PREFIX})`
      : Prisma.empty;

  const rows = await db.$queryRaw<TopDonorRow[]>(Prisma.sql`
    SELECT
      COALESCE(NULLIF(BTRIM(t."rawDonorName"), ''), t."donorName") AS name,
      SUM(p."amountCharged") AS total,
      COUNT(*) AS donation_count,
      BOOL_OR(t."isAnonymous") AS anonymous
    FROM "PaymentTransaction" p
    JOIN "Tip" t ON t.id = p."tipId"
    WHERE p."status" = 'SUCCESS'
      AND p."currency" = ${currency}
      ${liveFilter}
    GROUP BY 1
    ORDER BY total DESC, MIN(p."paidAt") ASC NULLS LAST
    LIMIT ${limit}
  `);

  const donors: TopDonor[] = rows.map((row, index) => {
    const rawName = String(row.name ?? "").trim();
    const isAnonymous = Boolean(row.anonymous) || rawName.toLowerCase() === "anonymous";

    return {
      rank: index + 1,
      displayName: isAnonymous ? ANONYMOUS_DISPLAY_NAME : rawName,
      total: Number(row.total ?? 0),
      donationCount: Number(row.donation_count ?? 0),
      anonymous: isAnonymous,
    };
  });

  return {
    mode,
    currency,
    generatedAt: new Date().toISOString(),
    donors,
  };
}
