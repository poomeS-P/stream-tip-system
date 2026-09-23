import { NextRequest, NextResponse } from "next/server";
import { verifyOverlayToken } from "@/lib/auth";
import { createSSEStream, sendHeartbeats } from "@/lib/sse";
import { db } from "@/lib/db";
import { broadcastAlert } from "@/lib/sse";
import type { AlertEventPayload } from "@/types";

/**
 * GET /api/alerts/stream?token=OVERLAY_TOKEN
 *
 * Server-Sent Events (SSE) endpoint สำหรับ OBS Browser Source
 * - ตรวจสอบ Overlay Token จาก query parameter (Browser Source ไม่รองรับ custom headers)
 * - ส่ง heartbeat ทุก 15 วินาทีเพื่อป้องกัน OBS timeout
 * - เมื่อ connect จะส่ง PENDING alert ที่ค้างอยู่ทันที (ถ้ามี)
 *
 * ต้องตั้งค่า Next.js config ไม่ cache route นี้
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ตรวจสอบ Overlay Token
  if (!verifyOverlayToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const { stream, clientId } = createSSEStream(() => {
    // Cleanup เมื่อ client ตัดการเชื่อมต่อ
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });

  // ส่ง Heartbeat ทุก 15 วินาที
  heartbeatInterval = setInterval(() => {
    sendHeartbeats();
  }, 15_000);

  // ส่ง PENDING alert ที่ค้างอยู่ทันทีที่ OBS reconnect
  const pendingAlert = await db.alertQueue.findFirst({
    where: { status: "PENDING" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: {
      tip: true,
    },
  });

  if (pendingAlert) {
    const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
    const tipAmount = Number(pendingAlert.tip.amount);
    const minTTS = settings ? Number(settings.minAmountForTTS) : 20;

    const payload: AlertEventPayload = {
      alertId: pendingAlert.id,
      tipId: pendingAlert.tip.id,
      donorName: pendingAlert.tip.donorName,
      amount: tipAmount,
      currency: pendingAlert.tip.currency,
      message: pendingAlert.tip.cleanMessage ?? pendingAlert.tip.message ?? "",
      hasFilteredWord: pendingAlert.tip.hasFilteredWord,
      ttsEnabled: pendingAlert.ttsEnabled && tipAmount >= minTTS,
      soundUrl: pendingAlert.soundUrl ?? "/alerts/alert.mp3",
      durationSeconds: pendingAlert.durationSeconds,
      createdAt: pendingAlert.createdAt.toISOString(),
    };

    // ส่งหลัง stream เริ่มต้นแล้ว
    setImmediate(() => broadcastAlert(payload));
  }

  console.log(`[sse] OBS client connected: ${clientId}`);

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
