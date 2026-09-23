-- โดเนทขั้นต่ำ 1 บาท (เดิม 10 บาท)
-- 1) เปลี่ยนค่า default ของคอลัมน์
ALTER TABLE "SystemSetting" ALTER COLUMN "minTipAmount" SET DEFAULT 1.00;

-- 2) แถวที่มีอยู่แล้วให้ใช้ค่าใหม่ (เฉพาะที่ยังเป็นค่าฐานเดิม 10 บาท)
UPDATE "SystemSetting" SET "minTipAmount" = 1.00 WHERE "minTipAmount" > 1.00;
