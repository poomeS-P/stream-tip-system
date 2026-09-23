/**
 * E2E STEP 9–10 — ยิง webhook เข้า /api/webhooks/payment พร้อมลายเซ็นสไตล์ Stripe
 *
 * ลายเซ็นคำนวณแบบเดียวกับ Stripe: HMAC-SHA256 ของ "<timestamp>.<raw body>"
 * ด้วยค่า STRIPE_WEBHOOK_SECRET ใน .env → ใช้ได้ทั้งค่า local ที่ตั้งเอง และค่าจริงจาก `stripe listen`
 *
 * รัน:
 *   npx tsx scripts/e2e/04-send-webhook.ts                     # ยิง 1 ครั้ง (คาดหวัง 200 received)
 *   npx tsx scripts/e2e/04-send-webhook.ts --times 2           # ขั้นที่ 10: ครั้งที่ 2 ต้องได้ duplicate
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode duplicate    # บังคับยิง 2 ครั้ง
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode unsigned     # ต้องได้ 400
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode tampered     # ต้องได้ 400 (พิสูจน์ว่าใช้ raw body)
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode expired       # non-payment event → PaymentTransaction = EXPIRED และไม่สร้าง Alert
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode async_pending  # checkout.session.completed (payment_status=unpaid) = จังหวะแรกของ PromptPay → ยัง PENDING ไม่มี Alert
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode async_paid     # checkout.session.async_payment_succeeded (PromptPay จ่ายสำเร็จ) → SUCCESS + สร้าง Alert
 *   npx tsx scripts/e2e/04-send-webhook.ts --mode async_failed   # checkout.session.async_payment_failed → PaymentTransaction = FAILED และไม่สร้าง Alert
 *
 * ลำดับทดสอบ PromptPay แบบ async (ตรงกับของจริง):
 *   03-prepare-payment → 04 --mode async_pending → 05 --expect-pending
 *                      → 04 --mode async_paid    → 05 (SUCCESS + Alert 1 แถว) → 06 --ack → 05 --expect-ack
 */

import { createHmac } from "node:crypto";
import {
  TEST_PREFIX,
  baseUrl,
  fail,
  finish,
  httpRequest,
  info,
  loadEnvFile,
  pass,
  pickBoolean,
  readState,
  requireEnv,
  section,
  warn,
  writeState,
} from "./_shared";

type Mode =
  | "signed"
  | "duplicate"
  | "unsigned"
  | "tampered"
  | "expired"
  | "async_pending"
  | "async_paid"
  | "async_failed";

function isMode(value: string): value is Mode {
  return (
    value === "signed" ||
    value === "duplicate" ||
    value === "unsigned" ||
    value === "tampered" ||
    value === "expired" ||
    value === "async_pending" ||
    value === "async_paid" ||
    value === "async_failed"
  );
}

/** map โหมดทดสอบ → Stripe event type ที่ต้องยิงเข้า webhook */
function eventTypeFor(mode: Mode): string {
  switch (mode) {
    case "expired":
      return "checkout.session.expired";
    case "async_paid":
      return "checkout.session.async_payment_succeeded";
    case "async_failed":
      return "checkout.session.async_payment_failed";
    default:
      // signed / duplicate / unsigned / tampered / async_pending
      return "checkout.session.completed";
  }
}

interface SessionState {
  paymentStatus: "paid" | "unpaid";
  status: "complete" | "expired";
}

/**
 * จำลองสถานะของ Checkout Session ให้ตรงกับพฤติกรรมจริงของ Stripe
 * - card (signed/duplicate/...): completed + paid → จ่ายทันที
 * - PromptPay: completed + unpaid ก่อน (async_pending) แล้วค่อยได้ async_payment_succeeded / async_payment_failed
 */
function sessionStateFor(mode: Mode): SessionState {
  switch (mode) {
    case "expired":
      return { paymentStatus: "unpaid", status: "expired" };
    case "async_pending":
    case "async_failed":
      return { paymentStatus: "unpaid", status: "complete" };
    default:
      return { paymentStatus: "paid", status: "complete" };
  }
}

function parseArgs(): { mode: Mode; times: number } {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const rawMode = get("mode") ?? "signed";
  const mode: Mode = isMode(rawMode) ? rawMode : "signed";
  const times = Number(get("times") ?? 1);

  return {
    mode,
    times: mode === "duplicate" ? Math.max(2, Number.isFinite(times) ? times : 1) : times,
  };
}

function buildEvent(
  eventId: string,
  type: string,
  sessionId: string,
  amount: number,
  currency: string,
  state: SessionState
): Record<string, unknown> {
  return {
    id: eventId,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: state.paymentStatus,
        status: state.status,
        amount_total: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        metadata: { e2e: "true" },
      },
    },
  };
}

function signPayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function main(): Promise<void> {
  loadEnvFile();
  const { mode, times } = parseArgs();
  const secret = requireEnv("STRIPE_WEBHOOK_SECRET");
  const state = readState();

  const { providerTxId } = state;
  const amount = state.amount ?? 100;
  const currency = state.currency ?? "THB";

  if (!providerTxId) {
    fail("ไม่พบ state การทดสอบ", "รัน: npx tsx scripts/e2e/03-prepare-payment.ts ก่อน");
    finish();
    return;
  }

  const eventType = eventTypeFor(mode);
  const eventState = sessionStateFor(mode);
  const eventId = `${TEST_PREFIX.eventId}${Date.now()}`;
  const payload = JSON.stringify(
    buildEvent(eventId, eventType, providerTxId, amount, currency, eventState)
  );
  const url = `${baseUrl()}/api/webhooks/payment`;

  section("STEP 9–10 — ยิง Webhook เข้า API");
  info(`   url     = ${url}`);
  info(`   eventId = ${eventId}`);
  info(`   type    = ${eventType}`);
  info(`   session = payment_status=${eventState.paymentStatus}, status=${eventState.status}`);
  info(`   mode    = ${mode} | times = ${times} | session = ${providerTxId}`);

  writeState({ eventId });

  if (mode === "expired" || mode === "async_failed") {
    warn(
      `โหมด ${mode}: ไม่ควรมี AlertQueue เกิดขึ้น`,
      "ตรวจด้วย 05-verify-db.ts --expect-no-alert (คาดหวัง FAILED หรือ EXPIRED)"
    );
  } else if (mode === "async_pending") {
    warn(
      "โหมด async_pending: PaymentTransaction ต้องยังเป็น PENDING และไม่ควรมี Alert",
      "ตรวจด้วย 05-verify-db.ts --expect-pending"
    );
  }

  for (let attempt = 1; attempt <= times; attempt += 1) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let rawBody = payload;

    if (mode === "tampered") {
      headers["stripe-signature"] = signPayload(payload, secret);
      rawBody = `${payload} `; // แก้ body หลังเซ็นแล้ว → ต้องถูกปฏิเสธ
    } else if (mode !== "unsigned") {
      headers["stripe-signature"] = signPayload(payload, secret);
    }

    let result;
    try {
      result = await httpRequest("POST", url, { rawBody, headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`ครั้งที่ ${attempt}: เรียก API ไม่ได้`, message);
      break;
    }

    const received = pickBoolean(result.json, "received") ?? false;
    const duplicate = pickBoolean(result.json, "duplicate") ?? false;
    info(`   [ครั้งที่ ${attempt}] HTTP ${result.status} → ${result.text.slice(0, 200)}`);

    if (mode === "unsigned" || mode === "tampered") {
      if (result.status === 400) pass(`ครั้งที่ ${attempt}: ปฏิเสธลายเซ็นที่ไม่ถูกต้อง (400)`);
      else fail(`ครั้งที่ ${attempt}: ควรได้ 400 แต่ได้ ${result.status}`);
      continue;
    }

    if (result.status === 200 && duplicate) {
      pass(`ครั้งที่ ${attempt}: ตรวจพบ webhook ซ้ำ และข้ามอย่างปลอดภัย (duplicate)`);
    } else if (result.status === 200 && received) {
      pass(`ครั้งที่ ${attempt}: ประมวลผล event ใหม่สำเร็จ`);
    } else {
      fail(
        `ครั้งที่ ${attempt}: ผลไม่เป็นไปตามคาด`,
        `HTTP ${result.status} ${result.text.slice(0, 160)}`
      );
    }
  }

  if (mode === "expired" || mode === "async_failed") {
    info("   → ขั้นต่อไป: npx tsx scripts/e2e/05-verify-db.ts --expect-no-alert");
  } else if (mode === "async_pending") {
    info(
      "   → ขั้นต่อไป: npx tsx scripts/e2e/05-verify-db.ts --expect-pending แล้วค่อยยิง --mode async_paid"
    );
  } else {
    info("   → ขั้นต่อไป: npx tsx scripts/e2e/05-verify-db.ts");
  }

  finish();
}

void main();
