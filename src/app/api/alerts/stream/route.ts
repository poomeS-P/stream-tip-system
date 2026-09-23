import { NextRequest, NextResponse } from "next/server";
import { verifyOverlayToken } from "@/lib/auth";
import { createSSEStream, sendHeartbeats } from "@/lib/sse";
import { broadcastNextPendingAlertIfIdle } from "@/lib/alert-queue";

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

  // ส่ง Alert ที่ค้างอยู่ในคิวทันทีที่ OBS (re)connect — ถ้าไม่มีรายการกำลังเล่นอยู่
  // (รายการที่ค้างสถานะ PLAYING จะถูกส่งต่อเมื่อ OBS ACK ของเดิม)
  setImmediate(() => {
    void broadcastNextPendingAlertIfIdle();
  });

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
