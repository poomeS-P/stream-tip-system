/**
 * JSON Value Types
 *
 * ใช้กับ Prisma Json field (เช่น WebhookEventLog.payloadJson)
 * ต้องเป็น Plain JSON เท่านั้น — ไม่มี undefined / Date / function
 * ประกาศไว้ที่นี่เพื่อไม่ให้ Shared Types ผูกกับ Prisma โดยตรง
 * (โครงสร้างนี้เข้ากันได้กับ Prisma.InputJsonValue โดยไม่ต้อง cast)
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CreateTipInput {
  donorName: string;
  isAnonymous?: boolean;
  amount: number;
  message?: string;
}

export interface PaymentSessionResult {
  checkoutUrl: string;
  providerTxId: string;
  amount: number;
  currency: string;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  eventId: string;
  eventType: string;
  providerTxId?: string;
  amount?: number;
  currency?: string;
  isPaid: boolean;
  /**
   * true = Provider แจ้งว่าการชำระเงิน "ล้มเหลว" (เช่น checkout.session.async_payment_failed ของ PromptPay)
   * ใช้เพื่อ mark PaymentTransaction เป็น FAILED โดยไม่สร้าง Alert
   */
  paymentFailed?: boolean;
  /**
   * true = Checkout Session หมดอายุโดยยังไม่มีการจ่าย (checkout.session.expired)
   * ใช้เพื่อ mark PaymentTransaction เป็น EXPIRED โดยไม่สร้าง Alert
   */
  paymentExpired?: boolean;
  /** Payload ดิบจาก Provider — ต้องเป็น Plain JSON เพื่อบันทึกลง Prisma Json field ได้โดยตรง */
  rawPayload: JsonObject;
  errorMessage?: string;
}

/**
 * Payment Provider Interface
 * ออกแบบเป็น Adapter Pattern เพื่อให้สลับหรือเพิ่ม Provider อื่น (เช่น Omise / Opn) ได้ในอนาคต
 */
export interface IPaymentProvider {
  readonly providerName: string;
  
  /**
   * สร้าง Hosted Checkout Session
   */
  createCheckoutSession(params: {
    tipId: string;
    amount: number;
    currency: string;
    donorName: string;
    message?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<PaymentSessionResult>;

  /**
   * ตรวจสอบ Cryptographic Signature ของ Webhook จาก Raw Body โดยตรง
   */
  verifyWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookVerificationResult>;
}

export interface AlertEventPayload {
  alertId: string;
  tipId: string;
  donorName: string;
  amount: number;
  currency: string;
  message: string;
  hasFilteredWord: boolean;
  ttsEnabled: boolean;
  soundUrl: string;
  durationSeconds: number;
  createdAt: string;
}

export interface EmergencyStatus {
  alertMuted: boolean;
  ttsMuted: boolean;
}
