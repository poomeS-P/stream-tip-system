import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOverlayToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcastNextPendingAlertIfIdle } from "@/lib/alert-queue";

const ackSchema = z.object({
  alertId: z.string().uuid(),
});

/**
 * POST /api/alerts/ack?token=OVERLAY_TOKEN
 *
 * OBS Overlay ส่งมาเมื่อแสดง Alert เสร็จสิ้นแล้ว
 * - ต้องมี Overlay Token (ตัวเดียวกับที่ใช้เชื่อมต่อ SSE) จึงจะ ACK ได้
 * - อัปเดตสถานะ AlertQueue เป็น COMPLETED
 * - ดึง Alert รายการถัดไปจากคิว PENDING และส่งผ่าน SSE
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Reuse Overlay Token ตัวเดียวกับ SSE — ไม่สร้างระบบ Auth ซ้ำซ้อน
  // ป้องกันการ ACK ข้ามระบบจากผู้ที่ไม่มี token (alertId เดาไม่ได้ แต่ endpoint ต้องปิด)
  if (!verifyOverlayToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid alertId" }, { status: 422 });
  }

  const { alertId } = parsed.data;

  // อัปเดตสถานะ
  await db.alertQueue.updateMany({
    where: { id: alertId, status: { in: ["PENDING", "PLAYING"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  // ส่ง Alert ถัดไปในคิว — เฉพาะเมื่อไม่มีรายการกำลังเล่นอยู่ (กันส่งทับกัน)
  const tick = await broadcastNextPendingAlertIfIdle();

  return NextResponse.json({
    success: true,
    next: tick.alertId,
    queued: tick.reason === "busy",
  });
}
