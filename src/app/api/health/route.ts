import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/health
 *
 * Healthcheck สำหรับแพลตฟอร์ม (Railway ใช้ `healthcheckPath` จาก railway.json)
 *
 * หลักการ:
 * - ตอบ 200 เสมอเมื่อ "ตัวแอปทำงาน" เพื่อไม่ให้ deployment ล้มเพราะ DB สะดุดชั่วคราว
 * - รายงานสถานะ DB ไว้ใน body เพื่อให้ตรวจสอบด้วยตาได้ (ไม่ผูกกับ healthcheck)
 * - ไม่เปิดเผยข้อมูลลับใด ๆ (ไม่ส่ง connection string / url / token)
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  let database: "up" | "down" = "down";

  try {
    await db.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  return NextResponse.json(
    {
      ok: true,
      database,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
