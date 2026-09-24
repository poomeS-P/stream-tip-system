import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { broadcastAlert } from "@/lib/sse";
import { DEFAULT_MIN_AMOUNT_FOR_TTS } from "@/lib/payment/limits";
import type { AlertEventPayload } from "@/types";

/**
 * คิว Alert ฝั่ง Server (ใช้ตาราง AlertQueue)
 *
 * ลำดับสถานะ: PENDING -> PLAYING (ส่งให้ OBS แล้ว) -> COMPLETED (OBS ACK หลังแสดงจบ)
 *
 * กติกาสำคัญที่แก้ปัญหานี้:
 *   "ห้ามส่ง Alert ใหม่ทับของเดิม" — ถ้ามีรายการ PLAYING อยู่ ต้องปล่อยให้อันใหม่เป็น PENDING
 *   แล้วค่อยถูกส่งต่อเมื่อ OBS ACK ของเดิม (ดู /api/alerts/ack) -> ได้คิวที่เล่นทีละอันเสมอ
 */

type AlertRowWithTip = Prisma.AlertQueueGetPayload<{ include: { tip: true } }>;

/** เวลาผ่อนผันหลังเลยกำหนดแสดง ก่อนถือว่า Alert ที่ค้าง PLAYING คือ "ตาย" (OBS ปิดกลางคัน) */
const STALE_GRACE_SECONDS = 30;

/** แปลงแถว AlertQueue (+ tip) เป็น payload ที่ Overlay ใช้ — จุดเดียวในระบบ */
export function toAlertPayload(row: AlertRowWithTip, minAmountForTTS: number): AlertEventPayload {
  const tipAmount = Number(row.tip.amount);

  return {
    alertId: row.id,
    tipId: row.tip.id,
    donorName: row.tip.donorName,
    amount: tipAmount,
    currency: row.tip.currency,
    message: row.tip.cleanMessage ?? row.tip.message ?? "",
    hasFilteredWord: row.tip.hasFilteredWord,
    ttsEnabled: row.ttsEnabled && tipAmount >= minAmountForTTS,
    soundUrl: row.soundUrl ?? "/alerts/alert.mp3",
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function readMinAmountForTTS(): Promise<number> {
  const settings = await db.systemSetting.findUnique({ where: { id: "default" } });

  return settings ? Number(settings.minAmountForTTS) : DEFAULT_MIN_AMOUNT_FOR_TTS;
}

/**
 * ปิดรายการที่ค้างสถานะ PLAYING นานเกินระยะที่ควรแสดงจริง
 * กันคิวตันถาวรเมื่อ OBS ถูกปิด/รีเฟรชกลางคันจนไม่มีใคร ACK
 */
async function reapStalePlaying(): Promise<number> {
  const playing = await db.alertQueue.findMany({
    where: { status: "PLAYING" },
    select: { id: true, durationSeconds: true, displayedAt: true, createdAt: true },
  });

  const now = Date.now();
  const staleIds = playing
    .filter((row) => {
      const startedAt = (row.displayedAt ?? row.createdAt).getTime();
      return now - startedAt > (row.durationSeconds + STALE_GRACE_SECONDS) * 1000;
    })
    .map((row) => row.id);

  if (staleIds.length === 0) return 0;

  await db.alertQueue.updateMany({
    where: { id: { in: staleIds }, status: "PLAYING" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  console.log(`[queue] ปิด Alert ค้างสถานะ PLAYING ${staleIds.length} รายการ (ไม่ได้รับ ACK)`);

  return staleIds.length;
}

export interface QueueTickResult {
  /** true = ส่ง Alert ใหม่ไปให้ Overlay แล้ว */
  broadcast: boolean;
  /** alertId ที่ถูกส่ง (null = ไม่ได้ส่ง) */
  alertId: string | null;
  reason: "sent" | "busy" | "empty" | "race";
}

/**
 * ส่ง Alert ถัดไปให้ Overlay — เฉพาะเมื่อ "ว่าง" จริง
 *
 * เรียกได้ทุกจุดที่คิวอาจขยับ: webhook (มีโดเนทใหม่) · ACK (แสดงจบ) · OBS เชื่อมต่อ · admin skip
 */
export async function broadcastNextPendingAlertIfIdle(): Promise<QueueTickResult> {
  await reapStalePlaying();

  const playing = await db.alertQueue.findFirst({
    where: { status: "PLAYING" },
    select: { id: true },
  });

  if (playing) return { broadcast: false, alertId: null, reason: "busy" };

  const next = await db.alertQueue.findFirst({
    where: { status: "PENDING" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { tip: true },
  });

  if (!next) return { broadcast: false, alertId: null, reason: "empty" };

  // จองแบบ atomic: ถ้ามีคำขออื่นชิงไปก่อน count จะเป็น 0 -> ไม่ส่งซ้ำ
  const claim = await db.alertQueue.updateMany({
    where: { id: next.id, status: "PENDING" },
    data: { status: "PLAYING", displayedAt: new Date() },
  });

  if (claim.count !== 1) return { broadcast: false, alertId: null, reason: "race" };

  broadcastAlert(toAlertPayload(next, await readMinAmountForTTS()));

  return { broadcast: true, alertId: next.id, reason: "sent" };
}
