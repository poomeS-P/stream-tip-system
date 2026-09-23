import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/admin/tips
 *
 * รายการ Tip ทั้งหมดพร้อมสถานะการชำระเงินและ Alert
 * Protected ด้วย Admin Token
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  const [tips, total] = await Promise.all([
    db.tip.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        paymentTransaction: {
          select: { status: true, paidAt: true, amountCharged: true, provider: true },
        },
        alertQueue: {
          select: { status: true, displayedAt: true, completedAt: true },
        },
      },
    }),
    db.tip.count(),
  ]);

  return NextResponse.json({
    tips,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
