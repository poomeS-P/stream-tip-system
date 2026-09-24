-- เกณฑ์อ่านเสียงเริ่มต้น 10 บาท (เดิม 20 บาท) = ยอดขั้นต่ำที่ Stripe ยอมรับสำหรับ THB
-- เหตุผล: ยอดที่จ่ายได้จริงเริ่มที่ ฿10 → เกณฑ์ 20 ทำให้โดเนทที่จ่ายแล้วขึ้นการ์ดแต่ "ไม่มีเสียงอ่าน"
-- (ตรงกับ DEFAULT_MIN_AMOUNT_FOR_TTS ใน src/lib/payment/limits.ts)

-- 1) เปลี่ยนค่า default ของคอลัมน์
ALTER TABLE "SystemSetting" ALTER COLUMN "minAmountForTTS" SET DEFAULT 10.00;

-- 2) แถวที่มีอยู่แล้วและยังเป็นค่าเริ่มต้นเดิม (20 บาท) → ใช้ค่าใหม่
--    ไม่แตะค่าที่เจ้าของช่องตั้งไว้เป็นอย่างอื่นด้วยตัวเอง
UPDATE "SystemSetting" SET "minAmountForTTS" = 10.00 WHERE "minAmountForTTS" = 20.00;
