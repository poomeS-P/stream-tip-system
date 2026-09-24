import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterContent, sanitizeName } from "@/lib/filter";
import { DEFAULT_MIN_AMOUNT_FOR_TTS } from "@/lib/payment/limits";
import { broadcastNextPendingAlertIfIdle } from "@/lib/alert-queue";
import { computeAlertDurationSeconds } from "@/lib/alert-duration";

const testAlertSchema = z.object({
  donorName: z.string().max(50).optional().default("Test User"),
  amount: z.number().positive().optional().default(100),
  message: z.string().max(255).optional().default("ทดสอบ Alert! 🎉"),
});

/**
 * POST /api/alerts/test
 *
 * Streamer ทดสอบ Alert จาก Admin Dashboard โดยไม่ต้องผ่านการจ่ายเงิน
 * Protected ด้วย Admin Token
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // ใช้ default ถ้าไม่มี body
  }

  const parsed = testAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const { donorName, amount, message } = parsed.data;

  const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
  const bannedWords = settings?.bannedWords ?? [];
  const blockEntire = settings?.blockEntireMessage ?? false;
  const maxLen = settings?.maxMessageLength ?? 150;
  const minTTS = settings ? Number(settings.minAmountForTTS) : DEFAULT_MIN_AMOUNT_FOR_TTS;

  const filterResult = filterContent(message, bannedWords, blockEntire, maxLen);
  const cleanName = sanitizeName(donorName, 50);

  // เวลาที่ค้างบนจอ = ขั้นต่ำที่ตั้งไว้ + เพิ่มตามความยาวข้อความ (ดู src/lib/alert-duration.ts)
  const duration = computeAlertDurationSeconds({
    donorName: cleanName,
    amount,
    message: filterResult.cleanText,
    baseSeconds: settings?.alertDurationSec ?? 8,
  });

  // สร้าง fake tip + alert สำหรับทดสอบ
  const fakeTip = await db.tip.create({
    data: {
      donorName: cleanName,
      rawDonorName: cleanName,
      isAnonymous: false,
      amount,
      currency: process.env.DEFAULT_CURRENCY ?? "THB",
      message,
      cleanMessage: filterResult.cleanText,
      hasFilteredWord: filterResult.hasFilteredWord,
    },
  });

  const fakeAlert = await db.alertQueue.create({
    data: {
      tipId: fakeTip.id,
      status: "PENDING",
      priority: 999, // Test alerts มี priority สูงสุด
      soundUrl: "/alerts/alert.mp3",
      durationSeconds: duration,
      ttsEnabled: amount >= minTTS,
    },
  });

  // ส่งให้ OBS ทันทีถ้าว่าง — ถ้ามี Alert กำลังเล่นอยู่ รายการนี้จะค้างเป็น PENDING
  // (priority 999 = สูงสุด จึงได้เล่นเป็นรายการถัดไปแน่นอน)
  const tick = await broadcastNextPendingAlertIfIdle();

  return NextResponse.json({ success: true, alertId: fakeAlert.id, queued: !tick.broadcast });
}
