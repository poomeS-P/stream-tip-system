import { NextRequest, NextResponse } from "next/server";
import { verifyOverlayToken } from "@/lib/auth";
import { broadcastPresence, createSSEStream, sendHeartbeats, type SseClientRole } from "@/lib/sse";
import { broadcastNextPendingAlertIfIdle } from "@/lib/alert-queue";

/**
 * GET /api/alerts/stream?token=OVERLAY_TOKEN[&role=voice]
 *
 * Server-Sent Events (SSE) endpoint สำหรับ OBS Browser Source
 * - ตรวจสอบ Overlay Token จาก query parameter (Browser Source ไม่รองรับ custom headers)
 * - ส่ง heartbeat ทุก 15 วินาทีเพื่อป้องกัน OBS timeout
 * - เมื่อ connect จะส่ง PENDING alert ที่ค้างอยู่ทันที (ถ้ามี)
 * - ส่ง event "presence" (จำนวน client แยกบทบาท) ให้ทุกหน้าต่าง เพื่อให้หน้าต่าง overlay
 *   รู้ว่ามี "ตัวอ่านเสียงภายนอก" (Edge /overlay/voice → role=voice) เชื่อมต่ออยู่หรือไม่
 *
 * role: "overlay" = หน้าต่าง OBS (ค่าเริ่มต้น — URL เดิมยังทำงานเหมือนเดิม)
 *       "voice"   = หน้าต่างอ่านเสียงเท่านั้นของ Edge (ไม่วาดการ์ด ไม่ ACK)
 *       "passive" = หน้าต่างที่แค่อ่าน event เช่นหน้า Top Donate Podium (ไม่จองคิว ไม่มีผลต่อการอ่านเสียง)
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

  const roleParam = req.nextUrl.searchParams.get("role");
  const role: SseClientRole =
    roleParam === "voice" ? "voice" : roleParam === "passive" ? "passive" : "overlay";

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const { stream, clientId } = createSSEStream(() => {
    // Cleanup เมื่อ client ตัดการเชื่อมต่อ
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    // จำนวน client เปลี่ยน → ให้หน้าต่างที่เหลือตัดสินใจเรื่องเสียงใหม่
    // (เช่น Edge ปิดไป → overlay กลับมาอ่านเสียงเองด้วยเสียงที่เครื่องมี)
    broadcastPresence();
  }, role);

  // ส่ง Heartbeat ทุก 15 วินาที
  heartbeatInterval = setInterval(() => {
    const removed = sendHeartbeats();

    // client ตายจากการส่ง heartbeat = จำนวนเปลี่ยน → แจ้งใหม่
    if (removed > 0) broadcastPresence();
  }, 15_000);

  // แจ้งจำนวน client (รวมตัวที่เพิ่งเชื่อมต่อ) ให้ทุกหน้าต่างรู้ทันที
  const counts = broadcastPresence();

  // ส่ง Alert ที่ค้างอยู่ในคิวทันทีที่ OBS (re)connect — ถ้าไม่มีรายการกำลังเล่นอยู่
  // (รายการที่ค้างสถานะ PLAYING จะถูกส่งต่อเมื่อ OBS ACK ของเดิม)
  setImmediate(() => {
    void broadcastNextPendingAlertIfIdle();
  });

  console.log(
    `[sse] client connected: ${clientId} role=${role} (overlay=${counts.overlay} voice=${counts.voice})`
  );

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
