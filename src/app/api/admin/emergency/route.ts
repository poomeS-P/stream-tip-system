import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcastEmergency } from "@/lib/sse";

const emergencySchema = z.object({
  alertMuted: z.boolean().optional(),
  ttsMuted: z.boolean().optional(),
});

/**
 * POST /api/admin/emergency
 *
 * Toggle ปิด/เปิด Alert และ TTS ฉุกเฉิน
 * OBS Overlay จะรับ SSE event "emergency" และหยุดทันที
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // ถ้าไม่มี body ให้ toggle สถานะปัจจุบัน
  }

  const parsed = emergencySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const current = await db.systemSetting.findUnique({ where: { id: "default" } });

  const newAlertMuted = parsed.data.alertMuted ?? !current?.emergencyAlertMuted;
  const newTTSMuted = parsed.data.ttsMuted ?? !current?.emergencyTTSMuted;

  const updated = await db.systemSetting.update({
    where: { id: "default" },
    data: {
      emergencyAlertMuted: newAlertMuted,
      emergencyTTSMuted: newTTSMuted,
    },
  });

  // Broadcast ไปยัง OBS ทันที
  broadcastEmergency({ alertMuted: newAlertMuted, ttsMuted: newTTSMuted });

  return NextResponse.json({
    success: true,
    emergencyAlertMuted: updated.emergencyAlertMuted,
    emergencyTTSMuted: updated.emergencyTTSMuted,
  });
}

/**
 * GET /api/admin/emergency
 *
 * ดูสถานะ Emergency ปัจจุบัน
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await db.systemSetting.findUnique({ where: { id: "default" } });

  return NextResponse.json({
    emergencyAlertMuted: settings?.emergencyAlertMuted ?? false,
    emergencyTTSMuted: settings?.emergencyTTSMuted ?? false,
  });
}
