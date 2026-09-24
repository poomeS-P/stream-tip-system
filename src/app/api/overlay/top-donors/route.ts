import { NextRequest, NextResponse } from "next/server";
import { verifyOverlayToken } from "@/lib/auth";
import { getTopDonors, type TopDonorMode } from "@/lib/top-donors";

/**
 * GET /api/overlay/top-donors?token=OVERLAY_TOKEN[&limit=3][&includeTest=1]
 *
 * อ่าน "ผู้สนับสนุนยอดสะสมสูงสุด" สำหรับ Top Donate Podium (อ่านอย่างเดียว ไม่เขียนอะไรเลย)
 *
 * Security
 * - ต้องมี Overlay Token (ตัวเดียวกับ /overlay และ SSE) ไม่งั้น 401
 * - ค่าเริ่มต้นนับเฉพาะ **ยอดจริง** (Stripe Live) → ไม่มียอดทดสอบ
 *   `includeTest=1` เปิดได้เฉพาะตอนพัฒนา/ทดสอบ เพื่อดูข้อมูลทั้งหมด (response จะบอก mode กลับมา)
 *
 * CORS
 * - เปิดให้เฉพาะ origin ของ overlay ระบบเก่าในเครื่อง (http://localhost:3000) เท่านั้น
 *   เพราะตัวสลับ (views/donate.html) ต้องอ่าน JSON นี้เพื่อ "ข้าม Podium เมื่อยังไม่มีผู้สนับสนุน"
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** origin ที่ยอมให้อ่านข้ามโดเมนได้ (หน้า http ของ overlay ระบบเก่าในเครื่อง) */
const ALLOWED_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }

  // ยังต้องส่ง Vary เพื่อไม่ให้ CDN cache คำตอบที่ผูกกับ origin ผิด
  return { Vary: "Origin" };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(req);

  if (!verifyOverlayToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limitParam = limitRaw === null || limitRaw.trim() === "" ? undefined : Number(limitRaw);
  const includeTest = req.nextUrl.searchParams.get("includeTest") === "1";
  const mode: TopDonorMode = includeTest ? "all" : "live";

  try {
    const result = await getTopDonors({
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
      mode,
      currency: process.env.DEFAULT_CURRENCY ?? "THB",
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { ...headers, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[top-donors] อ่านข้อมูลผู้สนับสนุนไม่สำเร็จ:", error);
    return NextResponse.json(
      { error: "Failed to read top donors" },
      { status: 500, headers: { ...headers, "Cache-Control": "no-store" } }
    );
  }
}

/** ตอบ preflight ของเบราว์เซอร์ (แม้ GET ธรรมดาไม่ต้องใช้ แต่กันอนาคตที่ส่ง header เพิ่มเอง) */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
