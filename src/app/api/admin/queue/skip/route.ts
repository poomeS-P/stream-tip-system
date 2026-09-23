import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcastNextPendingAlertIfIdle } from "@/lib/alert-queue";

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

  // ส่งรายการถัดไปในคิว (ตอนนี้ไม่มี PLAYING แล้ว -> helper จะส่งรายการแรกให้ทันที)
  const tick = await broadcastNextPendingAlertIfIdle();

  return NextResponse.json({
    success: true,
    skippedAlertId: current.id,
    next: tick.alertId,
  });
}
