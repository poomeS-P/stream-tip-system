/**
 * E2E STEP 4–5 — ตรวจ schema (หลัง prisma db push) และ seed
 *
 * รัน: npx tsx scripts/e2e/02-verify-schema-seed.ts
 *
 * หมายเหตุ: โปรเจกต์นี้ไม่มีโฟลเดอร์ prisma/migrations
 * จึงใช้ `npx prisma db push` (ตาม README) ไม่ใช่ `prisma migrate`
 */

import { PrismaClient } from "@prisma/client";
import {
  fail,
  finish,
  info,
  loadEnvFile,
  pass,
  section,
  warn,
  writeState,
} from "./_shared";

async function main(): Promise<void> {
  loadEnvFile();
  const db = new PrismaClient();

  try {
    section("4) ตรวจ schema (ตารางทั้งหมดตาม prisma/schema.prisma)");
    try {
      const [tips, payments, alerts, logs] = await Promise.all([
        db.tip.count(),
        db.paymentTransaction.count(),
        db.alertQueue.count(),
        db.webhookEventLog.count(),
      ]);
      pass("ตาราง Tip / PaymentTransaction / AlertQueue / WebhookEventLog ใช้งานได้");
      info(
        `   baseline (ก่อนทดสอบ): tips=${tips} payments=${payments} alerts=${alerts} webhookLogs=${logs}`
      );
      writeState({ baseline: { tips, payments, alerts, webhookLogs: logs } });
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      fail("ยังไม่มีตารางใน DB หรือ schema ไม่ตรง", message);
      info("   → รัน: npx prisma db push");
      return;
    }

    section("5) ตรวจ seed (SystemSetting id=default)");
    const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
    if (!settings) {
      fail("ไม่พบ SystemSetting id=default", "รัน: npm run db:seed");
    } else {
      pass("พบ SystemSetting id=default");
      info(
        `   streamerName=${settings.streamerName} | minTipAmount=${settings.minTipAmount} | minAmountForTTS=${settings.minAmountForTTS} | alertDurationSec=${settings.alertDurationSec} | bannedWords=${settings.bannedWords.length} คำ`
      );
      if (settings.emergencyAlertMuted || settings.emergencyTTSMuted) {
        warn(
          `Emergency ถูกปิดอยู่ (alertMuted=${settings.emergencyAlertMuted}, ttsMuted=${settings.emergencyTTSMuted})`,
          "ก่อนทดสอบ SSE ควรตั้งทั้งสองเป็น false (หรือทดสอบ Emergency ก่อน)"
        );
      } else {
        pass("Emergency เปิดอยู่ทั้ง Alert และ TTS (พร้อมทดสอบ SSE)");
      }
    }
  } finally {
    await db.$disconnect();
  }

  finish();
}

void main();
