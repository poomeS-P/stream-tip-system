import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/admin/queue/clear
 *
 * ล้างคิว Alert ที่รออยู่ทั้งหมด (ไม่แตะ COMPLETED/SKIPPED)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.alertQueue.updateMany({
    where: { status: { in: ["PENDING", "PLAYING"] } },
    data: { status: "SKIPPED", completedAt: new Date() },
  });

  return NextResponse.json({ success: true, clearedCount: result.count });
}
