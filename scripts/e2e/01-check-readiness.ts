/**
 * E2E STEP 1–3, 6–7 — ตรวจความพร้อมก่อนทดสอบ
 *
 * ตรวจ:
 *  1) Docker CLI + Docker Engine
 *  2) PostgreSQL container (stream_tip_postgres) และพอร์ต 5432
 *  3) DATABASE_URL และการเชื่อมต่อ DB จริง (SELECT 1)
 *  6) Stripe Test Mode env vars
 *  7) STRIPE_WEBHOOK_SECRET
 *
 * รัน: npx tsx scripts/e2e/01-check-readiness.ts
 * ต้องรันหลัง `docker compose up -d db` (ดู docs/E2E_RUNBOOK.md)
 */

import { PrismaClient } from "@prisma/client";
import {
  baseUrl,
  fail,
  finish,
  info,
  loadEnvFile,
  pass,
  requireEnv,
  runCommand,
  section,
  tcpProbe,
  warn,
} from "./_shared";

const CONTAINER_NAME = "stream_tip_postgres";

async function main(): Promise<void> {
  loadEnvFile();

  section("1) Docker Desktop / Docker Engine");
  const dockerCli = runCommand("docker", ["--version"]);
  if (dockerCli.ok) pass("Docker CLI พร้อม", dockerCli.output.split("\n")[0]);
  else fail("ไม่พบ Docker CLI", "ติดตั้ง Docker Desktop ก่อน");

  const engine = runCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (engine.ok && !/error/i.test(engine.output)) {
    pass("Docker Engine ทำงาน", `server ${engine.output}`);
  } else {
    fail(
      "Docker Engine ไม่ตอบสนอง",
      "เปิด Docker Desktop (ถ้า engine ไม่ขึ้น ให้ตรวจ WSL2/'Virtual Machine Platform' — ดูหัวข้อ Blocker ใน docs/E2E_RUNBOOK.md)"
    );
  }

  section("2) PostgreSQL container");
  const ps = runCommand("docker", [
    "ps",
    "-a",
    "--filter",
    `name=${CONTAINER_NAME}`,
    "--format",
    "{{.Names}}|{{.State}}|{{.Status}}|{{.Ports}}",
  ]);
  if (ps.ok && ps.output.includes(CONTAINER_NAME)) {
    const [name, state, status, ports] = ps.output.split("|");
    info(`   container: ${name} | state=${state} | status=${status} | ports=${ports}`);
    if (state === "running") pass("container กำลังทำงาน");
    else fail("container หยุดอยู่", "รัน: docker compose up -d db");
    if (/healthy/i.test(status ?? "")) pass("container healthcheck = healthy");
    else warn("healthcheck ยังไม่ healthy", "รอสักครู่แล้วรันสคริปต์นี้อีกครั้ง");
  } else {
    fail("ไม่พบ container", "รัน: docker compose up -d db");
  }

  const port5432 = await tcpProbe("localhost", 5432);
  if (port5432) pass("พอร์ต 5432 เปิด");
  else fail("พอร์ต 5432 ปิด", "container ยังไม่พร้อม หรือมี service อื่นใช้พอร์ตนี้อยู่");

  section("3) DATABASE_URL + การเชื่อมต่อจริง");
  const databaseUrl = requireEnv("DATABASE_URL");
  try {
    const parsed = new URL(databaseUrl);
    info(
      `   host=${parsed.hostname} port=${parsed.port || "5432"} db=${parsed.pathname.replace("/", "")} user=${parsed.username} schema=${parsed.searchParams.get("schema") ?? "-"}`
    );
    pass("DATABASE_URL parse ได้");
    if (parsed.hostname === "db") {
      warn(
        "ค่า DATABASE_URL ชี้ไปที่ host 'db'",
        "ในเครื่อง (ไม่ใช่ใน Docker network) ต้องเป็น localhost — ดู .env"
      );
    }
  } catch {
    fail("DATABASE_URL ไม่ถูกต้องตามรูปแบบ URL");
  }

  const db = new PrismaClient();
  try {
    await db.$queryRaw`SELECT 1`;
    pass("เชื่อมต่อ PostgreSQL สำเร็จ (SELECT 1)");
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    fail("เชื่อมต่อ PostgreSQL ไม่ได้", message);
  } finally {
    await db.$disconnect();
  }

  section("6) Stripe Test Mode environment variables");
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  if (secretKey.startsWith("sk_test_")) pass("STRIPE_SECRET_KEY เป็น Test Mode (sk_test_)");
  else if (secretKey.length > 0)
    warn("STRIPE_SECRET_KEY ไม่ได้ขึ้นต้นด้วย sk_test_", "ตรวจค่าใน .env (ไม่แสดงค่าเพื่อความปลอดภัย)");
  else fail("ไม่มี STRIPE_SECRET_KEY");

  if (secretKey.includes("placeholder")) {
    warn(
      "STRIPE_SECRET_KEY ยังเป็นค่า placeholder",
      "ขั้นที่ 9 แบบ Stripe จริงจะใช้ไม่ได้ (แต่แบบ offline self-signed ใช้ได้)"
    );
  }

  if (publishableKey.startsWith("pk_test_")) pass("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY เป็น Test Mode");
  else warn("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ว่างหรือไม่ใช่ pk_test_", "ไม่บังคับสำหรับ Hosted Checkout");
  info(`   DEFAULT_CURRENCY=${process.env.DEFAULT_CURRENCY ?? "-"}`);

  section("7) STRIPE_WEBHOOK_SECRET");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (webhookSecret.startsWith("whsec_")) pass("STRIPE_WEBHOOK_SECRET มีรูปแบบถูกต้อง (whsec_)");
  else fail("STRIPE_WEBHOOK_SECRET ไม่ถูกต้อง", "ต้องได้จาก `stripe listen` หรือค่าที่ตั้งเองสำหรับทดสอบ offline");

  if (webhookSecret.includes("placeholder")) {
    warn(
      "STRIPE_WEBHOOK_SECRET ยังเป็นค่า placeholder",
      "สคริปต์ 04-send-webhook.ts จะยังเซ็นลายเซ็นได้ (ใช้ค่าใน .env) แต่ Stripe CLI จริงจะไม่ผ่าน"
    );
  }

  section("สรุปคำสั่งถัดไป");
  info(`   API base: ${baseUrl()}`);
  info("   ถ้าทุกอย่าง PASS → ไปขั้นที่ 4: npx prisma db push");

  finish();
}

void main();
