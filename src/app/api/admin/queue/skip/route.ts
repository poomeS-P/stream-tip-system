import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcastAlert } from "@/lib/sse";
import type { AlertEventPayload } from "@/types";

/**
 * POST /api/admin/queue/skip
 *
 * ข้าม Alert ที่กำลังเล่นอยู่หรืออยู่ในคิว PENDING
 * แล้วเล่น Alert ถัดไปทันที
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mark PLAYING/PENDING alert แรกว่า SKIPPED
  const current = await db.alertQueue.findFirst({
    where: { status: { in: ["PLAYING", "PENDING"] } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  if (!current) {
    return NextResponse.json({ success: true, message: "No active alert to skip" });
  }

  await db.alertQueue.update({
    where: { id: current.id },
    data: { status: "SKIPPED", completedAt: new Date() },
  });

  // ดึง Alert ถัดไป
  const next = await db.alertQueue.findFirst({
    where: { status: "PENDING" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { tip: true },
  });

  if (next) {
    const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
    const tipAmount = Number(next.tip.amount);
    const minTTS = settings ? Number(settings.minAmountForTTS) : 20;

    const payload: AlertEventPayload = {
      alertId: next.id,
      tipId: next.tip.id,
      donorName: next.tip.donorName,
      amount: tipAmount,
      currency: next.tip.currency,
      message: next.tip.cleanMessage ?? next.tip.message ?? "",
      hasFilteredWord: next.tip.hasFilteredWord,
      ttsEnabled: next.ttsEnabled && tipAmount >= minTTS,
      soundUrl: next.soundUrl ?? "/alerts/alert.mp3",
      durationSeconds: next.durationSeconds,
      createdAt: next.createdAt.toISOString(),
    };

    broadcastAlert(payload);

    await db.alertQueue.update({
      where: { id: next.id },
      data: { status: "PLAYING", displayedAt: new Date() },
    });
  }

  return NextResponse.json({ success: true, skippedAlertId: current.id });
}
