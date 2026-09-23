/**
 * E2E STEP 9 (เตรียมข้อมูล) — สร้าง Tip + PaymentTransaction(PENDING)
 *
 * จำลองสถานะ "ผู้ชมกดจ่ายเงินแล้ว แต่ยังไม่ได้รับ webhook"
 * รัน: npx tsx scripts/e2e/03-prepare-payment.ts [--amount 100] [--currency THB]
 *
 * ปลอดภัย: ใช้ providerTxId นำหน้าด้วย "cs_test_e2e_" เท่านั้น (cleanup ลบได้เฉพาะข้อมูลนี้)
 */

import { PrismaClient } from "@prisma/client";
import {
  TEST_PREFIX,
  fail,
  finish,
  info,
  loadEnvFile,
  pass,
  section,
  writeState,
} from "./_shared";

interface Options {
  amount: number;
  currency: string;
  donor: string;
  message: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  return {
    amount: Number(get("amount") ?? 100),
    currency: (get("currency") ?? process.env.DEFAULT_CURRENCY ?? "THB").toUpperCase(),
    donor: get("donor") ?? "E2E Test Donor",
    message: get("message") ?? "E2E test: ทดสอบระบบทิป 🎉",
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const options = parseArgs();

  if (!Number.isFinite(options.amount) || options.amount <= 0) {
    fail("ค่า --amount ต้องเป็นตัวเลขมากกว่า 0");
    finish();
    return;
  }

  const db = new PrismaClient();
  try {
    section("STEP 9 (เตรียม) — สร้างข้อมูลทดสอบ");

    const providerTxId = `${TEST_PREFIX.providerTxId}${Date.now()}`;

    const tip = await db.tip.create({
      data: {
        donorName: options.donor,
        rawDonorName: options.donor,
        isAnonymous: false,
        amount: options.amount,
        currency: options.currency,
        message: options.message,
        cleanMessage: options.message,
        hasFilteredWord: false,
      },
    });

    const payment = await db.paymentTransaction.create({
      data: {
        tipId: tip.id,
        provider: "stripe",
        providerTxId,
        amountCharged: options.amount,
        currency: options.currency,
        status: "PENDING",
        checkoutUrl: "https://checkout.stripe.com/c/pay/e2e-test-session",
      },
    });

    writeState({
      tipId: tip.id,
      paymentTxId: payment.id,
      providerTxId,
      amount: options.amount,
      currency: options.currency,
      createdAt: new Date().toISOString(),
    });

    pass("สร้าง Tip + PaymentTransaction(status=PENDING) เรียบร้อย");
    info(`   tipId        = ${tip.id}`);
    info(`   paymentTxId  = ${payment.id}`);
    info(`   providerTxId = ${providerTxId}`);
    info(`   amount       = ${options.amount} ${options.currency}`);
    info("   → ขั้นต่อไป: npx tsx scripts/e2e/04-send-webhook.ts");
  } finally {
    await db.$disconnect();
  }

  finish();
}

void main();
