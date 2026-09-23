import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/admin/settings  — ดึงการตั้งค่าปัจจุบัน
 * PUT /api/admin/settings  — บันทึกการตั้งค่าใหม่
 */

const settingsSchema = z.object({
  streamerName: z.string().max(50).optional(),
  minTipAmount: z.number().positive().optional(),
  maxMessageLength: z.number().int().min(10).max(500).optional(),
  minAmountForTTS: z.number().positive().optional(),
  alertDurationSec: z.number().int().min(3).max(60).optional(),
  bannedWords: z.array(z.string().max(100)).optional(),
  blockEntireMessage: z.boolean().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
  if (!settings) {
    return NextResponse.json({ error: "Settings not found" }, { status: 404 });
  }

  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }

  const updated = await db.systemSetting.upsert({
    where: { id: "default" },
    update: { ...parsed.data },
    create: {
      id: "default",
      ...parsed.data,
    },
  });

  return NextResponse.json(updated);
}
