import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isOverlayToken } from "@/lib/overlay-token";

/**
 * ตรวจสอบ Admin Token จาก Authorization header หรือ Cookie
 * Admin และ Overlay Token แยกออกจากกัน ไม่ใช้ค่าเดียวกัน
 */
export function verifyAdminToken(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token === env.ADMIN_TOKEN;
  }

  // รองรับ Cookie-based session สำหรับ Browser Dashboard
  const cookieToken = req.cookies.get("admin_token")?.value;
  if (cookieToken) {
    return cookieToken === env.ADMIN_TOKEN;
  }

  return false;
}

/**
 * ตรวจสอบ Overlay Token สำหรับ OBS Browser Source SSE stream
 * ใช้ Query Parameter เนื่องจาก Browser Source ไม่รองรับ custom header
 *
 * ใช้ isOverlayToken() เพื่อรองรับกรณี token มี "+" แล้วถูก decode เป็นเว้นวรรค
 * (ผู้ใช้ paste URL ดิบ ๆ) — ดู src/lib/overlay-token.ts
 */
export function verifyOverlayToken(req: NextRequest): boolean {
  return isOverlayToken(req.nextUrl.searchParams.get("token"), env.OVERLAY_TOKEN);
}
