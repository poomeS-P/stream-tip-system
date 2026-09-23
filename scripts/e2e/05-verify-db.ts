/**
 * E2E STEP 8, 10, 11, 14 — ตรวจสถานะจริงในฐานข้อมูล
 *
 * รัน:
 *   npx tsx scripts/e2e/05-verify-db.ts                    # หลัง webhook ยืนยันการจ่าย: Payment=SUCCESS, paidAt มีค่า, AlertQueue=1
 *   npx tsx scripts/e2e/05-verify-db.ts --expect-pending   # จังหวะแรกของ PromptPay (completed แต่ยัง unpaid): Payment=PENDING, ไม่มี Alert
 *   npx tsx scripts/e2e/05-verify-db.ts --expect-no-alert  # ล้มเหลว/หมดอายุ: Payment=FAILED|EXPIRED, ไม่มี Alert
 *   npx tsx scripts/e2e/05-verify-db.ts --expect-ack       # หลัง ACK: Alert ต้องเป็น COMPLETED
 */

import { PrismaClient } from "@prisma/client";
import {
  fail,
  finish,
  info,
  loadEnvFile,
  pass,
  readState,
  section,
  warn,
  writeState,
} from "./_shared";

async function main(): Promise<void> {
  loadEnvFile();
  const args = process.argv.slice(2);
  const expectPending = args.includes("--expect-pending");
  const expectNoAlert = args.includes("--expect-no-alert");
  const expectAck = args.includes("--expect-ack");

  const state = readState();
  const { tipId, paymentTxId, providerTxId, eventId } = state;

  if (!tipId || !paymentTxId || !providerTxId || !eventId) {
    fail(
      "ไม่พบ state การทดสอบ",
      "รัน: npx tsx scripts/e2e/03-prepare-payment.ts และ 04-send-webhook.ts ก่อน"
    );
    finish();
    return;
  }

  const db = new PrismaClient();
  try {
    section("11a) Tip");
    const tip = await db.tip.findUnique({ where: { id: tipId } });
    if (!tip) {
      fail("ไม่พบ Tip ตาม state", tipId);
    } else {
      info(
        `   donorName=${tip.donorName} amount=${tip.amount} ${tip.currency} hasFilteredWord=${tip.hasFilteredWord}`
      );
      info(`   message=${tip.message ?? "-"}`);
      pass("พบ Tip ที่ผูกกับการทดสอบ");
      if (state.amount !== undefined && Number(tip.amount) === state.amount) {
        pass(`ยอดเงิน Tip ตรงกับที่เตรียมไว้ (${state.amount} ${tip.currency})`);
      } else {
        warn(`ยอดเงิน Tip (${tip.amount}) ไม่ตรงกับ state (${state.amount ?? "-"})`);
      }
    }

    section("11b) PaymentTransaction");
    const payment = await db.paymentTransaction.findUnique({ where: { id: paymentTxId } });
    if (!payment) {
      fail("ไม่พบ PaymentTransaction ตาม state", paymentTxId);
    } else {
      info(
        `   status=${payment.status} amountCharged=${payment.amountCharged} ${payment.currency} provider=${payment.provider}`
      );
      info(
        `   paidAt=${payment.paidAt ? payment.paidAt.toISOString() : "-"} providerTxId=${payment.providerTxId ?? "-"}`
      );

      if (expectPending) {
        // จังหวะแรกของ PromptPay: Stripe ยังไม่ยืนยันการจ่าย → ต้องยังเป็น PENDING และไม่มี paidAt
        if (payment.status === "PENDING") {
          pass("PaymentTransaction ยังเป็น PENDING (ถูกต้องก่อนได้รับการยืนยันการจ่าย)");
        } else {
          fail(`PaymentTransaction เป็น ${payment.status}`, "โหมด --expect-pending คาดหวัง PENDING");
        }
        if (payment.paidAt === null) pass("paidAt ยังว่าง (ยังไม่มีการจ่ายจริง)");
        else fail("paidAt มีค่าแล้ว", "ไม่ควรมีค่าเมื่อยังไม่ได้รับการยืนยันการจ่าย");
      } else if (expectNoAlert) {
        // การจ่ายล้มเหลว/หมดอายุ → ต้องไม่ใช่ SUCCESS
        if (payment.status === "FAILED" || payment.status === "EXPIRED") {
          pass(`PaymentTransaction = ${payment.status} (ถูกต้องตามเหตุการณ์ล้มเหลว/หมดอายุ)`);
        } else {
          fail(`PaymentTransaction เป็น ${payment.status}`, "คาดหวัง FAILED หรือ EXPIRED");
        }
        if (payment.paidAt === null) pass("paidAt ยังว่าง");
        else fail("paidAt มีค่า", "ไม่ควรมีค่าเมื่อการจ่ายล้มเหลว/หมดอายุ");
      } else {
        if (payment.status === "SUCCESS") pass("PaymentTransaction = SUCCESS (Stripe ยืนยันแล้ว)");
        else fail(`PaymentTransaction ยังเป็น ${payment.status}`, "คาดหวัง SUCCESS");

        if (payment.paidAt) pass("paidAt ถูกบันทึก");
        else fail("paidAt ยังว่าง", "webhook ต้องเซ็ต paidAt เมื่อจ่ายสำเร็จ");
      }

      if (payment.providerTxId === providerTxId) pass("providerTxId ตรงกับข้อมูลทดสอบ");
      else fail("providerTxId ไม่ตรง", `expected=${providerTxId} got=${payment.providerTxId ?? "-"}`);
    }

    section("11c) WebhookEventLog (idempotency)");
    const logs = await db.webhookEventLog.findMany({ where: { eventId } });
    info(`   พบ log ของ eventId นี้ = ${logs.length} แถว`);
    if (logs.length === 1) pass("มี WebhookEventLog เพียง 1 แถว (unique constraint ทำงาน)");
    else if (logs.length === 0) fail("ไม่พบ WebhookEventLog", "webhook อาจไม่ถูกบันทึก");
    else fail(`พบ log ${logs.length} แถว`, "ต้องมี 1 แถวเท่านั้น");

    if (logs[0]) {
      info(`   eventType=${logs[0].eventType} provider=${logs[0].provider} processed=${logs[0].processed}`);
      if (logs[0].processed) pass("WebhookEventLog.processed = true");
      else fail("WebhookEventLog.processed ยังเป็น false");
      if (logs[0].payloadJson) pass("payloadJson ถูกบันทึก (raw payload จาก Stripe)");
      else fail("payloadJson ว่าง");
    }

    section("11d) AlertQueue (ต้องไม่ซ้ำ)");
    const alerts = await db.alertQueue.findMany({
      where: { tipId },
      orderBy: { createdAt: "asc" },
    });
    info(`   พบ Alert ของ tip นี้ = ${alerts.length} แถว`);

    if (expectPending || expectNoAlert) {
      if (alerts.length === 0) {
        pass(
          expectPending
            ? "ยังไม่มี Alert (ถูกต้อง — ยังไม่มีการยืนยันการจ่าย)"
            : "ไม่มี Alert เกิดขึ้น (ถูกต้องสำหรับการจ่ายที่ล้มเหลว/หมดอายุ)"
        );
      } else {
        fail(`ไม่ควรมี Alert แต่พบ ${alerts.length} แถว`);
      }
    } else if (alerts.length === 1) {
      pass("มี AlertQueue เพียง 1 แถว → duplicate webhook ไม่สร้าง Alert ซ้ำ ✅");
    } else if (alerts.length === 0) {
      fail(
        "ไม่พบ Alert เลย",
        "คาดหวัง 1 แถว — ตรวจว่า event เป็น checkout.session.completed และ PaymentTransaction.providerTxId ตรงกัน"
      );
    } else {
      fail(`พบ Alert ${alerts.length} แถว`, "ต้องมีเพียง 1 แถว — ตรวจ idempotency");
    }

    if (alerts[0]) {
      const alert = alerts[0];
      info(`   alertId=${alert.id} status=${alert.status} priority=${alert.priority}`);
      info(
        `   soundUrl=${alert.soundUrl ?? "-"} durationSeconds=${alert.durationSeconds} ttsEnabled=${alert.ttsEnabled}`
      );
      info(
        `   displayedAt=${alert.displayedAt ? alert.displayedAt.toISOString() : "-"} completedAt=${alert.completedAt ? alert.completedAt.toISOString() : "-"}`
      );
      writeState({ alertId: alert.id });

      if (expectAck) {
        if (alert.status === "COMPLETED") pass("Alert = COMPLETED (ACK จาก overlay สำเร็จ)");
        else fail(`Alert status = ${alert.status}`, "คาดหวัง COMPLETED หลัง ACK");
        if (alert.completedAt) pass("completedAt ถูกบันทึก");
        else fail("completedAt ยังว่าง");
      } else if (alert.status === "PENDING" || alert.status === "PLAYING") {
        pass(`Alert status = ${alert.status} (พร้อมให้ OBS/SSE แสดง)`);
      } else if (alert.status === "COMPLETED") {
        pass("Alert ถูก ACK แล้ว (COMPLETED) — ใช้ --expect-ack เพื่อยืนยันแบบเข้มงวด");
      } else {
        warn(
          `Alert status = ${alert.status}`,
          "เกิดจากการสั่งข้าม/ระงับจาก Dashboard ไม่ใช่ความล้มเหลวของ webhook"
        );
      }
    }
  } finally {
    await db.$disconnect();
  }

  finish();
}

void main();
