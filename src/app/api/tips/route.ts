import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { filterContent, sanitizeName } from "@/lib/filter";
import { getPaymentProvider } from "@/lib/payment";

const createTipSchema = z.object({
  donorName: z.string().min(1).max(50).optional(),
  isAnonymous: z.boolean().optional().default(false),
  amount: z.number().positive().max(100_000),
  message: z.string().max(255).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate Limiting: 10 requests / minute per IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const limiter = rateLimit(`tip_create_${ip}`, 10, 60_000);

  if (!limiter.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limiter.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Limit": String(limiter.limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // Parse & Validate input
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { isAnonymous, amount, message } = parsed.data;
  const rawDonorName = parsed.data.donorName?.trim() ?? "";

  // ดึง settings จาก DB
  const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
  const minAmount = settings ? Number(settings.minTipAmount) : 10;
  const maxMsgLen = settings?.maxMessageLength ?? 150;
  const bannedWords = settings?.bannedWords ?? [];
  const blockEntire = settings?.blockEntireMessage ?? false;

  if (amount < minAmount) {
    return NextResponse.json(
      { error: `Minimum tip amount is ${minAmount} ${env.DEFAULT_CURRENCY}` },
      { status: 422 }
    );
  }

  // กำหนดชื่อที่แสดง
  const displayName = isAnonymous ? "ผู้ไม่ประสงค์ออกนาม" : sanitizeName(rawDonorName || "Anonymous", 50);

  // กรองข้อความ
  const filterResult = filterContent(message ?? "", bannedWords, blockEntire, maxMsgLen);

  // สร้าง Tip record ก่อน
  const tip = await db.tip.create({
    data: {
      donorName: displayName,
      rawDonorName: isAnonymous ? "anonymous" : rawDonorName.substring(0, 50),
      isAnonymous: isAnonymous ?? false,
      amount,
      currency: env.DEFAULT_CURRENCY,
      message: message?.substring(0, 255) ?? null,
      cleanMessage: filterResult.cleanText || null,
      hasFilteredWord: filterResult.hasFilteredWord,
    },
  });

  // สร้าง Hosted Checkout Session ผ่าน Payment Provider Adapter
  const provider = getPaymentProvider();
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  let sessionResult;
  try {
    sessionResult = await provider.createCheckoutSession({
      tipId: tip.id,
      amount,
      currency: env.DEFAULT_CURRENCY,
      donorName: displayName,
      message: filterResult.cleanText || undefined,
      successUrl: `${appUrl}/success`,
      cancelUrl: `${appUrl}/cancel`,
    });
  } catch (err) {
    // ลบ tip ที่ยังไม่ได้ชำระออก เพื่อความสะอาด
    await db.tip.delete({ where: { id: tip.id } }).catch(() => {});
    console.error("[tips] Failed to create checkout session:", err);
    return NextResponse.json({ error: "Payment provider error" }, { status: 502 });
  }

  // บันทึก PaymentTransaction
  await db.paymentTransaction.create({
    data: {
      tipId: tip.id,
      provider: provider.providerName,
      providerTxId: sessionResult.providerTxId,
      amountCharged: amount,
      currency: env.DEFAULT_CURRENCY,
      status: "PENDING",
      checkoutUrl: sessionResult.checkoutUrl,
    },
  });

  return NextResponse.json(
    {
      success: true,
      tipId: tip.id,
      checkoutUrl: sessionResult.checkoutUrl,
    },
    { status: 201 }
  );
}
