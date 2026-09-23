import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { broadcastAlert } from "@/lib/sse";
import type { AlertEventPayload } from "@/types";

/**
 * POST /api/webhooks/payment
 *
 * รับ Signed Webhook จาก Stripe โดยตรง
 * ห้ามเชื่อข้อมูลจาก Frontend — สถานะ "ชำระแล้ว" ต้องมาจาก Webhook นี้เท่านั้น
 *
 * Security:
 * - ตรวจสอบ Signature ด้วย stripe.webhooks.constructEvent จาก Raw Body (ห้ามใช้ parsed JSON)
 * - Idempotency: WebhookEventLog.eventId มี @unique constraint ใน DB
 *   ถ้า INSERT ซ้ำจะ throw P2002 → ส่ง 200 OK กลับทันที (ไม่ประมวลผลซ้ำ)
 * - ทุกอย่างรันใน prisma.$transaction เพื่อ atomic operation
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // อ่าน Raw Body สำหรับ Signature Verification
  // ต้องใช้ arrayBuffer → Buffer ไม่ใช่ req.json()
  let rawBody: Buffer;
  try {
    const ab = await req.arrayBuffer();
    rawBody = Buffer.from(ab);
  } catch {
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  const provider = getPaymentProvider();

  // ตรวจสอบ Signature โดย Stripe SDK จาก Raw Body โดยตรง
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const verification = await provider.verifyWebhook(rawBody, headers);

  if (!verification.isValid) {
    console.warn("[webhook] Invalid signature:", verification.errorMessage);
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  // ป้องกัน Webhook ซ้ำด้วย DB Unique Constraint + Transaction
  // ถ้า eventId ซ้ำ → Prisma throw P2002 → return 200 OK ทันที (Idempotent)
  //
  // สำคัญ: ห้ามเรียก broadcastAlert ภายใน callback ของ $transaction
  // เพราะถ้า transaction rollback ทีหลัง OBS จะได้รับ Alert ของรายการที่ไม่ได้ commit
  // วิธีที่ถูกต้อง: ให้ callback คืน payload ออกมา แล้ว broadcast หลัง commit สำเร็จเท่านั้น
  let alertToBroadcast: AlertEventPayload | null = null;

  try {
    alertToBroadcast = await db.$transaction(async (tx): Promise<AlertEventPayload | null> => {
      // INSERT WebhookEventLog — จะ throw P2002 ถ้า eventId ซ้ำ
      await tx.webhookEventLog.create({
        data: {
          provider: provider.providerName,
          eventId: verification.eventId,
          eventType: verification.eventType,
          payloadJson: verification.rawPayload,
          processed: false,
        },
      });

      // 1) กรณี "ไม่สำเร็จ" — mark สถานะให้ตรงกับ schema แล้วไม่สร้าง Alert
      //    - checkout.session.async_payment_failed → FAILED (เช่น PromptPay จ่ายไม่สำเร็จ)
      //    - checkout.session.expired               → EXPIRED (ผู้ชมไม่จ่ายภายในเวลาที่กำหนด)
      //
      // สำคัญ: ไม่ mark ทับถ้าเป็น SUCCESS อยู่แล้ว (กัน event ผิดลำดับมาลดสถานะที่จ่ายจริงแล้ว)
      const failureStatus: "FAILED" | "EXPIRED" | null = verification.paymentFailed
        ? "FAILED"
        : verification.paymentExpired
          ? "EXPIRED"
          : null;

      if (failureStatus && verification.providerTxId) {
        const paymentToClose = await tx.paymentTransaction.findUnique({
          where: { providerTxId: verification.providerTxId },
        });

        if (paymentToClose && paymentToClose.status !== "SUCCESS") {
          await tx.paymentTransaction.update({
            where: { id: paymentToClose.id },
            data: { status: failureStatus },
          });
          console.warn(
            "[webhook] Payment marked as",
            failureStatus,
            verification.providerTxId,
            verification.eventType
          );
        }

        await tx.webhookEventLog.update({
          where: { eventId: verification.eventId },
          data: { processed: true },
        });

        return null;
      }

      // 2) Process เฉพาะ event ที่จ่ายเงินสำเร็จ (ยืนยันจาก Stripe แล้วเท่านั้น)
      //    - checkout.session.completed            (card/3DS) → payment_status = paid
      //    - checkout.session.async_payment_succeeded (PromptPay) → ยืนยันการจ่ายแล้ว
      if (verification.isPaid && verification.providerTxId) {
        const paymentTx = await tx.paymentTransaction.findUnique({
          where: { providerTxId: verification.providerTxId },
          include: { tip: true },
        });

        if (!paymentTx) {
          console.warn("[webhook] PaymentTransaction not found for:", verification.providerTxId);
          // บันทึกว่า event นี้ถูกจัดการแล้ว (ตรวจแล้วไม่มีอะไรต้องทำ)
          await tx.webhookEventLog.update({
            where: { eventId: verification.eventId },
            data: { processed: true },
          });
          return null;
        }

        if (paymentTx.status === "SUCCESS") {
          // จ่ายแล้ว ไม่ต้องทำอะไร (defensive idempotency)
          // กัน Alert ซ้ำในกรณีมี event คนละ eventId ที่อ้างถึงการจ่ายรายการเดียวกัน
          // เช่น checkout.session.async_payment_succeeded + payment_intent.succeeded
          await tx.webhookEventLog.update({
            where: { eventId: verification.eventId },
            data: { processed: true },
          });
          return null;
        }

        // อัปเดต PaymentTransaction เป็น SUCCESS
        await tx.paymentTransaction.update({
          where: { id: paymentTx.id },
          data: {
            status: "SUCCESS",
            paidAt: new Date(),
          },
        });

        // ดึง settings สำหรับ Alert
        const settings = await tx.systemSetting.findUnique({ where: { id: "default" } });
        const tipAmount = Number(paymentTx.amountCharged);
        const minTTS = settings ? Number(settings.minAmountForTTS) : 20;
        const duration = settings?.alertDurationSec ?? 8;

        // สร้าง AlertQueue entry
        const alert = await tx.alertQueue.create({
          data: {
            tipId: paymentTx.tipId,
            status: "PENDING",
            priority: tipAmount >= 500 ? 10 : tipAmount >= 100 ? 5 : 0,
            soundUrl: "/alerts/alert.mp3",
            durationSeconds: duration,
            ttsEnabled: tipAmount >= minTTS,
          },
        });

        // อัปเดต WebhookEventLog ว่า processed แล้ว
        await tx.webhookEventLog.update({
          where: { eventId: verification.eventId },
          data: { processed: true },
        });

        // สร้าง payload ที่จะใช้ broadcast ไว้ "คืนค่า" ออกไป
        // โดยยังไม่ broadcast ในนี้ — caller จะ broadcast หลัง transaction commit สำเร็จ
        const tip = paymentTx.tip;
        const alertPayload: AlertEventPayload = {
          alertId: alert.id,
          tipId: tip.id,
          donorName: tip.donorName,
          amount: tipAmount,
          currency: tip.currency,
          message: tip.cleanMessage ?? tip.message ?? "",
          hasFilteredWord: tip.hasFilteredWord,
          ttsEnabled: tipAmount >= minTTS,
          soundUrl: "/alerts/alert.mp3",
          durationSeconds: duration,
          createdAt: alert.createdAt.toISOString(),
        };

        // คืน payload ออกไปให้ caller broadcast หลัง commit เท่านั้น
        return alertPayload;
      }

      // Non-payment event (เช่น checkout.session.expired) — mark processed
      await tx.webhookEventLog.update({
        where: { eventId: verification.eventId },
        data: { processed: true },
      });

      return null;
    });
  } catch (err: unknown) {
    // P2002 = Unique constraint violation = Duplicate webhook — ส่ง 200 OK (Idempotent)
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      console.log("[webhook] Duplicate eventId received, skipping:", verification.eventId);
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.error("[webhook] Transaction error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Broadcast หลัง await db.$transaction(...) สำเร็จเท่านั้น
  // ถ้า transaction rollback จะ throw ไปที่ catch ด้านบน → ไม่ broadcast
  // จึงรับประกันได้ว่า OBS จะไม่ได้รับ Alert ของรายการที่ไม่ได้ commit ลง DB
  if (alertToBroadcast) {
    broadcastAlert(alertToBroadcast);
  }

  return NextResponse.json({ received: true });
}
