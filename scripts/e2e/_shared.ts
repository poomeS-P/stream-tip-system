/**
 * E2E Test — Shared Helpers
 *
 * ไฟล์นี้เป็นเครื่องมือทดสอบเท่านั้น ไม่ถูก import จาก application code
 * รันด้วย: npx tsx scripts/e2e/<script>.ts
 *
 * หลักการ:
 * - อ่านค่าจาก .env ของโปรเจกต์เอง (ไม่พึ่ง dotenv package)
 * - เก็บ state ของการทดสอบไว้ที่ไฟล์ชั่วคราวใน OS temp (ไม่ทิ้งไฟล์ในโปรเจกต์)
 * - ใช้ PrismaClient ตรง ๆ (ไม่ import app code) เพื่อไม่ผูกกับ Next.js runtime
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

export const PROJECT_ROOT = process.cwd();
export const STATE_FILE = path.join(tmpdir(), "stream-tip-e2e-state.json");

/** prefix ของข้อมูลทดสอบ — ใช้เป็น guard ตอน cleanup ไม่ให้ลบข้อมูลจริง */
export const TEST_PREFIX = {
  providerTxId: "cs_test_e2e_",
  eventId: "evt_e2e_",
};

export interface E2EState {
  /** PaymentTransaction.id */
  paymentTxId?: string;
  /** Tip.id */
  tipId?: string;
  /** Stripe Checkout Session id (ใช้เป็น providerTxId) */
  providerTxId?: string;
  /** Stripe event id ที่ใช้ยิง webhook */
  eventId?: string;
  /** AlertQueue.id ของ alert ที่เกิดจาก webhook */
  alertId?: string;
  /** AlertQueue.id ของ alert ที่เกิดจาก /api/alerts/test (admin) */
  testAlertId?: string;
  amount?: number;
  currency?: string;
  createdAt?: string;
  /** จำนวนแถวใน DB ก่อนเริ่มทดสอบ (baseline) */
  baseline?: { tips: number; payments: number; alerts: number; webhookLogs: number };
}

let failureCount = 0;

// ---------- Output ----------

export function info(message: string): void {
  console.log(message);
}

export function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

export function pass(name: string, detail = ""): void {
  console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

export function warn(name: string, detail = ""): void {
  console.log(`[WARN] ${name}${detail ? ` — ${detail}` : ""}`);
}

export function fail(name: string, detail = ""): void {
  failureCount += 1;
  console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
}

export function finish(): void {
  console.log(
    failureCount === 0
      ? "\nผลรวม: PASS ทั้งหมด ✅"
      : `\nผลรวม: มี ${failureCount} รายการที่ไม่ผ่าน ❌`
  );
  process.exitCode = failureCount === 0 ? 0 : 1;
}

// ---------- State ----------

export function readState(): E2EState {
  if (!existsSync(STATE_FILE)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return isRecord(parsed) ? (parsed as E2EState) : {};
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<E2EState>): E2EState {
  const next: E2EState = { ...readState(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function clearState(): void {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE, { force: true });
}

// ---------- Env ----------

/** โหลด .env ของโปรเจกต์ (ไม่ทับค่าที่มีอยู่ใน process.env แล้ว) */
export function loadEnvFile(): void {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) {
    warn("ไม่พบไฟล์ .env", envPath);
    return;
  }

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    fail(`ต้องมีค่า ${key} ใน .env`);
    finish();
    process.exit(1);
  }
  return value;
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300";
}

// ---------- Type guards (ไม่ใช้ as any) ----------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function pickString(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

export function pickNumber(source: unknown, key: string): number | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "number" ? value : undefined;
}

export function pickBoolean(source: unknown, key: string): boolean | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

// ---------- HTTP / System ----------

export interface HttpResult {
  status: number;
  text: string;
  json: unknown;
}

export async function httpRequest(
  method: string,
  url: string,
  options: { body?: unknown; rawBody?: string; headers?: Record<string, string> } = {}
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const init: RequestInit = { method, headers };

  if (options.rawBody !== undefined) {
    // ใช้เมื่อต้องส่ง body ดิบ (เช่น ทดสอบว่า signature ผูกกับ raw body จริง)
    init.body = options.rawBody;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, init);
  const text = await res.text();

  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: res.status, text, json };
}

export async function waitForHttp(url: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status > 0) return true;
    } catch {
      // server ยังไม่ขึ้น — ลองใหม่
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export function runCommand(command: string, args: string[]): { ok: boolean; output: string } {
  // หมายเหตุ: ห้ามใช้ shell: true บน Windows เพราะอักขระ `|` ใน argument
  // (เช่น docker --format "{{.Names}}|{{.State}}") จะถูก cmd.exe ตีความเป็น pipe ทำให้คำสั่งเพี้ยน
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}
