/**
 * ยอดขั้นต่ำของการ "ช่องทางชำระเงิน" (คนละตัวกับ SystemSetting.minTipAmount ที่เป็นนโยบายของช่อง)
 *
 * ทำไมต้องมี: ผู้ให้บริการจ่ายเงินมีเพดานขั้นต่ำของตัวเอง เช่น Stripe ไม่ยอมสร้าง Checkout Session
 * ที่ยอดรวมต่ำกว่า ฿10 (THB) โดยตอบ error code `amount_too_small`
 * -> ถ้าปล่อยผ่าน จะกลายเป็น 502 "Payment provider error" ที่ผู้ชมอ่านไม่รู้เรื่อง
 *
 * นโยบายของเว็บนี้: โดเนทขั้นต่ำ 1 บาท (SystemSetting.minTipAmount = 1)
 * แต่ช่องทางบัตร/PromptPay (Stripe) ต้อง >= 10 บาท · ยอด 1-9 บาท ต้องใช้ช่องทางโอนตรง (ยังไม่เปิดใช้งาน)
 */
const PROVIDER_MINIMUM_AMOUNT: Record<string, number> = {
  THB: 10,
  USD: 0.5,
  EUR: 0.5,
};

/** ยอดขั้นต่ำที่ผู้ให้บริการยอมรับ (บาท/สกุลที่ตั้งไว้) — ค่าเริ่มต้น 1 สำหรับสกุลที่ไม่รู้จัก */
export function getProviderMinimumAmount(currency: string): number {
  return PROVIDER_MINIMUM_AMOUNT[currency.toUpperCase()] ?? 1;
}
