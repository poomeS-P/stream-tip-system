import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterContent, sanitizeName } from "@/lib/filter";
import { broadcastAlert } from "@/lib/sse";
import type { AlertEventPayload } from "@/types";

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
  const duration = settings?.alertDurationSec ?? 8;
  const minTTS = settings ? Number(settings.minAmountForTTS) : 20;

  const filterResult = filterContent(message, bannedWords, blockEntire, maxLen);
  const cleanName = sanitizeName(donorName, 50);

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

  const payload: AlertEventPayload = {
    alertId: fakeAlert.id,
    tipId: fakeTip.id,
    donorName: cleanName,
    amount,
    currency: process.env.DEFAULT_CURRENCY ?? "THB",
    message: filterResult.cleanText,
    hasFilteredWord: filterResult.hasFilteredWord,
    ttsEnabled: amount >= minTTS,
    soundUrl: "/alerts/alert.mp3",
    durationSeconds: duration,
    createdAt: fakeAlert.createdAt.toISOString(),
  };

  broadcastAlert(payload);

  return NextResponse.json({ success: true, alertId: fakeAlert.id });
}
