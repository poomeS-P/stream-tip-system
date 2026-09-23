/**
 * E2E STEP 18 — Cleanup: ลบข้อมูลทดสอบและคืนสภาพแวดล้อม
 *
 * รัน: npx tsx scripts/e2e/99-cleanup.ts [--force-unmute]
 *
 * ความปลอดภัย: ลบเฉพาะข้อมูลที่สร้างโดยสคริปต์ E2E
 *  - Tip / PaymentTransaction / AlertQueue ที่ผูกกับ state การทดสอบเท่านั้น
 *  - WebhookEventLog ที่ eventId ขึ้นต้นด้วย "evt_e2e_"
 *  - ไม่แตะ SystemSetting (ยกเว้น --force-unmute เพื่อเปิด Emergency คืน)
 */

import { PrismaClient } from "@prisma/client";
import {
  TEST_PREFIX,
  clearState,
  finish,
  info,
  loadEnvFile,
  pass,
  readState,
  section,
  warn,
} from "./_shared";

/** ชื่อผู้บริจาคมาตรฐานที่สคริปต์ E2E ใช้ (03-prepare-payment.ts และ 07-admin-api.ts) */
const TEST_DONOR_NAME = "E2E Test Donor";
const TEST_ALERT_DONOR_NAME = "E2E Test Alert";

async function main(): Promise<void> {
  loadEnvFile();
  const forceUnmute = process.argv.slice(2).includes("--force-unmute");
  const state = readState();

  const db = new PrismaClient();
  try {
    section("STEP 18 — Cleanup ข้อมูลทดสอบ");

    // 1) WebhookEventLog (ตาม eventId ใน state + prefix evt_e2e_)
    const logIds = new Set<string>();
    if (state.eventId) {
      const rows = await db.webhookEventLog.findMany({
        where: { eventId: state.eventId },
        select: { id: true },
      });
      rows.forEach((row) => logIds.add(row.id));
    }
    const prefixedLogs = await db.webhookEventLog.findMany({
      where: { eventId: { startsWith: TEST_PREFIX.eventId } },
      select: { id: true },
    });
    prefixedLogs.forEach((row) => logIds.add(row.id));

    const deletedLogs =
      logIds.size > 0
        ? await db.webhookEventLog.deleteMany({ where: { id: { in: [...logIds] } } })
        : { count: 0 };
    pass(`ลบ WebhookEventLog ${deletedLogs.count} แถว`);

    // 2) หา Tip/PaymentTransaction/AlertQueue ของการทดสอบ "ทั้งหมด"
    //    (ไม่พึ่ง state อย่างเดียว เพราะการทดสอบจริงอาจ prepare หลายรายการก่อน cleanup)
    //    เกณฑ์ที่ปลอดภัย: providerTxId ขึ้นต้นด้วย prefix ทดสอบ หรือ donorName มาตรฐานของสคริปต์
    const tipIds = new Set<string>();
    const alertIds = new Set<string>();

    if (state.alertId) alertIds.add(state.alertId);
    if (state.testAlertId) alertIds.add(state.testAlertId);
    if (state.tipId) tipIds.add(state.tipId);

    const prefixedPayments = await db.paymentTransaction.findMany({
      where: { providerTxId: { startsWith: TEST_PREFIX.providerTxId } },
      select: { tipId: true },
    });
    prefixedPayments.forEach((p) => tipIds.add(p.tipId));
    info(`   พบ PaymentTransaction ที่มี prefix ทดสอบ = ${prefixedPayments.length} แถว`);

    // Tip ที่สร้างจาก /api/alerts/test (07-admin-api.ts) จะไม่มี PaymentTransaction
    const donorNameTips = await db.tip.findMany({
      where: { rawDonorName: { in: [TEST_DONOR_NAME, TEST_ALERT_DONOR_NAME] } },
      select: { id: true, paymentTransaction: { select: { providerTxId: true } } },
    });
    for (const tip of donorNameTips) {
      const providerTxId = tip.paymentTransaction?.providerTxId ?? null;
      if (providerTxId && !providerTxId.startsWith(TEST_PREFIX.providerTxId)) {
        // กันลบข้อมูลจริงที่บังเอิญใช้ชื่อเดียวกัน (มี providerTxId ของ Stripe จริง)
        warn("ข้าม Tip ที่มี PaymentTransaction ไม่ใช่ข้อมูลทดสอบ", tip.id.slice(0, 8));
        continue;
      }
      tipIds.add(tip.id);
    }

    const deletedAlerts =
      alertIds.size > 0
        ? await db.alertQueue.deleteMany({ where: { id: { in: [...alertIds] } } })
        : { count: 0 };
    if (deletedAlerts.count > 0) {
      pass(`ลบ AlertQueue ${deletedAlerts.count} แถว (ตาม alertId)`);
    }

    if (tipIds.size > 0) {
      const deletedAlertsByTip = await db.alertQueue.deleteMany({
        where: { tipId: { in: [...tipIds] } },
      });
      pass(`ลบ AlertQueue ${deletedAlertsByTip.count} แถว (ตาม tip)`);

      const deletedPayments = await db.paymentTransaction.deleteMany({
        where: { tipId: { in: [...tipIds] } },
      });
      pass(`ลบ PaymentTransaction ${deletedPayments.count} แถว`);

      const deletedTips = await db.tip.deleteMany({ where: { id: { in: [...tipIds] } } });
      pass(`ลบ Tip ${deletedTips.count} แถว`);
    } else {
      pass("ไม่พบข้อมูลทดสอบที่ต้องลบ");
    }

    // 3) Emergency flags
    const settings = await db.systemSetting.findUnique({ where: { id: "default" } });
    if (!settings) {
      warn("ไม่พบ SystemSetting id=default");
    } else if (settings.emergencyAlertMuted || settings.emergencyTTSMuted) {
      warn(
        `Emergency ยังปิดอยู่ (alertMuted=${settings.emergencyAlertMuted}, ttsMuted=${settings.emergencyTTSMuted})`
      );
      if (forceUnmute) {
        await db.systemSetting.update({
          where: { id: "default" },
          data: { emergencyAlertMuted: false, emergencyTTSMuted: false },
        });
        pass("เปิด Emergency คืนแล้ว (--force-unmute)");
      } else {
        info("   → เปิดคืนด้วย: npx tsx scripts/e2e/99-cleanup.ts --force-unmute");
      }
    } else {
      pass("Emergency อยู่ในสถานะปกติ (false ทั้งคู่)");
    }

    // 4) เทียบกับ baseline แล้วลบ state
    const counts = {
      tips: await db.tip.count(),
      payments: await db.paymentTransaction.count(),
      alerts: await db.alertQueue.count(),
      webhookLogs: await db.webhookEventLog.count(),
    };
    info(
      `   คงเหลือ: tips=${counts.tips} payments=${counts.payments} alerts=${counts.alerts} webhookLogs=${counts.webhookLogs}`
    );

    const baseline = state.baseline;
    if (baseline) {
      const same =
        baseline.tips === counts.tips &&
        baseline.payments === counts.payments &&
        baseline.alerts === counts.alerts &&
        baseline.webhookLogs === counts.webhookLogs;
      if (same) pass("จำนวนแถวกลับเท่ากับ baseline ก่อนทดสอบ ✅");
      else
        warn(
          "จำนวนแถวไม่เท่ากับ baseline",
          `baseline tips=${baseline.tips} payments=${baseline.payments} alerts=${baseline.alerts} logs=${baseline.webhookLogs}`
        );
    }

    clearState();
    pass("ลบไฟล์ state ของการทดสอบแล้ว");

    info("\nคำสั่งคืนสภาพแวดล้อม (เลือกตามต้องการ):");
    info("   docker compose stop db        # หยุด container (ข้อมูลยังอยู่)");
    info("   docker compose down           # ลบ container (volume ยังอยู่)");
    info("   docker compose down -v        # ⚠️ ลบ volume = ลบข้อมูลทั้งหมด");
  } finally {
    await db.$disconnect();
  }

  finish();
}

void main();
