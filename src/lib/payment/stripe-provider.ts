import Stripe from "stripe";
import { env } from "@/lib/env";
import { toJsonObject } from "@/lib/json";
import type { IPaymentProvider, PaymentSessionResult, WebhookVerificationResult } from "@/types";

/**
 * Stripe Payment Provider Implementation
 *
 * ใช้ Stripe Hosted Checkout Session (ไม่เก็บข้อมูลบัตรเอง)
 * ตรวจสอบ Webhook Signature โดยตรงจาก Raw Body ด้วย Stripe SDK
 *
 * ห้ามเขียนระบบตรวจ Signature เองแบบ generic — ใช้ stripe.webhooks.constructEvent เท่านั้น
 */
export class StripeProvider implements IPaymentProvider {
  readonly providerName = "stripe";

  private readonly stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      // ใช้ API Version ที่ Stripe SDK ที่ติดตั้งอยู่ Pin ไว้ (stripe@22.6.2 → "2026-08-26.dahlia")
      // StripeConfig.apiVersion รับได้เฉพาะ LatestApiVersion literal เท่านั้น
      // การอ้าง Stripe.API_VERSION จึง Type-Safe และไม่เกิด Version Drift เมื่ออัปเกรด SDK
      apiVersion: Stripe.API_VERSION,
      typescript: true,
    });
  }

  async createCheckoutSession(params: {
    tipId: string;
    amount: number;
    currency: string;
    donorName: string;
    message?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<PaymentSessionResult> {
    const { tipId, amount, currency, donorName, message, successUrl, cancelUrl } = params;

    // Stripe ใช้หน่วยเป็น smallest currency unit (สตางค์สำหรับ THB)
    const unitAmount = Math.round(amount * 100);

    const description = [
      `Tip from: ${donorName}`,
      message ? `Message: ${message.substring(0, 100)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      // ใช้ Dynamic Payment Methods: ไม่ระบุ payment_method_types
      // Stripe จะเลือกวิธีจ่ายที่ "เปิดใช้งานใน Dashboard" และเข้ากับสกุลเงิน/ประเทศของผู้ชมให้เอง
      // → บัตรเครดิต/เดบิตยังใช้ได้เหมือนเดิม และ PromptPay (ไทย · THB) จะแสดงกับผู้ชมที่เกี่ยวข้อง
      //
      // ต้องเปิดใช้งานใน Stripe Dashboard → Settings → Payment methods (ทั้ง Test และ Live):
      //   • Card       (ปกติเปิดอยู่แล้วโดย Stripe)
      //   • PromptPay  (ต้องมี business location = Thailand และใช้สกุลเงิน THB)
      //
      // ถ้าจำเป็นต้องกำหนดเองแบบ manual (Stripe ไม่แนะนำ) ให้เปลี่ยนเป็น:
      //   payment_method_types: ["card", "promptpay"],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: "Stream Tip / Donation",
              description,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        tipId,
        donorName: donorName.substring(0, 50),
      },
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      // หมดอายุใน 30 นาที
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return {
      checkoutUrl: session.url,
      providerTxId: session.id,
      amount,
      currency,
    };
  }

  async verifyWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookVerificationResult> {
    const signature = headers["stripe-signature"];

    if (!signature) {
      return {
        isValid: false,
        eventId: "",
        eventType: "",
        isPaid: false,
        rawPayload: {},
        errorMessage: "Missing Stripe-Signature header",
      };
    }

    let event: Stripe.Event;

    try {
      // ใช้ Stripe SDK ตรวจสอบ Signature โดยตรงจาก Raw Body
      // ห้ามส่ง parsed JSON — ต้องเป็น raw buffer/string เท่านั้น
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        Array.isArray(signature) ? signature[0] : signature,
        env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown webhook signature error";
      return {
        isValid: false,
        eventId: "",
        eventType: "",
        isPaid: false,
        rawPayload: {},
        errorMessage: `Webhook signature verification failed: ${errorMessage}`,
      };
    }

    // ตรวจสอบ event ที่เกี่ยวกับการชำระเงินของ Checkout Session
    // - checkout.session.completed              → card/3DS ที่จ่ายทันที (payment_status = paid)
    //                                             หรือ PromptPay ที่เพิ่งเลือกจ่าย (ยัง unpaid → ยังไม่ให้ Alert)
    // - checkout.session.async_payment_succeeded → วิธีจ่ายแบบ delayed notification (PromptPay ฯลฯ)
    //                                             จ่ายสำเร็จจริงแล้ว → ถือเป็น isPaid
    // - checkout.session.async_payment_failed    → วิธีจ่ายแบบ delayed notification ล้มเหลว
    // - checkout.session.expired                 → หมดเวลาโดยยังไม่จ่าย (ต้อง mark EXPIRED ที่ DB)
    //
    // ทุก event อ้างถึง Checkout Session เดียวกัน → ใช้ session.id เป็น providerTxId ได้เหมือนเดิม
    // จึงไม่ต้องแก้ Database Schema
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      const session = event.data.object;

      const isPaid =
        event.type === "checkout.session.async_payment_succeeded" ||
        (event.type === "checkout.session.completed" &&
          session.payment_status === "paid" &&
          session.status === "complete");

      const amountTotal = session.amount_total ? session.amount_total / 100 : undefined;
      const currency = session.currency?.toUpperCase() ?? undefined;

      return {
        isValid: true,
        eventId: event.id,
        eventType: event.type,
        providerTxId: session.id,
        amount: amountTotal,
        currency,
        isPaid,
        paymentFailed: event.type === "checkout.session.async_payment_failed",
        paymentExpired: event.type === "checkout.session.expired",
        rawPayload: toJsonObject(event),
      };
    }

    // Event อื่น ๆ เช่น payment_intent.succeeded / payment_intent.payment_failed / charge.succeeded
    // → บันทึกเป็น log เท่านั้น (ไม่ mark SUCCESS/FAILED, ไม่สร้าง Alert)
    //
    // เหตุผลที่ "ไม่" ใช้ payment_intent.* เป็นตัวตัดสิน:
    //   1) สำหรับ Checkout เราใช้ checkout.session.* เป็นแหล่งความจริงเดียว (session.id = providerTxId ใน DB)
    //      ส่วน PaymentIntent id คนละค่ากับ session id → ต้อง lookup เพิ่มและเสี่ยง map ผิดรายการ
    //   2) 1 Checkout Session อาจมีหลาย PaymentIntent (เมื่อผู้ชมพิมพ์บัตรผิด/ลองใหม่) และ
    //      payment_intent.payment_failed อาจเกิดกลางทางแล้ว "จ่ายสำเร็จภายหลัง" → ถ้า mark FAILED ทันทีจะผิดสถานะ
    //   3) ถ้านับทั้ง session event และ PI event เป็น "จ่ายสำเร็จ" จะได้ 2 event ต่อการจ่าย 1 ครั้ง
    //      ซึ่งแม้มี guard (status=SUCCESS + AlertQueue.tipId unique) กันไว้ ก็เป็นความเสี่ยงที่ไม่จำเป็น
    return {
      isValid: true,
      eventId: event.id,
      eventType: event.type,
      isPaid: false,
      rawPayload: toJsonObject(event),
    };
  }
}
