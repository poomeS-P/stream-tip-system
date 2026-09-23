import { NextRequest } from "next/server";
import { env } from "@/lib/env";

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
 */
export function verifyOverlayToken(req: NextRequest): boolean {
  const token = req.nextUrl.searchParams.get("token");
  return token !== null && token === env.OVERLAY_TOKEN;
}
