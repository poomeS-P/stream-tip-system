/**
 * verify-db-tables.mjs — ตรวจว่าตารางที่ Prisma migration สร้าง "มีอยู่จริง" ในฐานข้อมูล
 *
 * ใช้ได้ทั้งในเครื่องและใน Railway Shell (container มี node_modules + prisma client อยู่แล้ว)
 *   node scripts/verify-db-tables.mjs
 *
 * อ่าน DATABASE_URL จาก environment (ไม่พิมพ์ค่าออกมา)
 * exit code 0 = ตารางครบ | 1 = ขาด/เชื่อมต่อไม่ได้
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ถ้า DATABASE_URL ไม่ถูกตั้งไว้ (เช่นรันในเครื่อง) ให้โหลดจาก .env ของโปรเจกต์
// (ไม่พิมพ์ค่าใด ๆ ออกมา)
if (!process.env.DATABASE_URL) {
    const envPath = path.join(process.cwd(), ".env");
    if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            const i = t.indexOf("=");
            if (i < 0) continue;
            const key = t.slice(0, i).trim();
            const value = t.slice(i + 1).trim().replace(/^"|"$/g, "");
            if (!process.env[key]) process.env[key] = value;
        }
    }
}

const EXPECTED = ["Tip", "PaymentTransaction", "AlertQueue", "WebhookEventLog", "SystemSetting"];

const db = new PrismaClient();

try {
    const rows = await db.$queryRaw`
        select tablename from pg_tables where schemaname = 'public' order by tablename
    `;
    const names = rows.map((r) => r.tablename);

    console.log("tables in public : " + (names.length ? names.join(", ") : "(none)"));

    const missing = EXPECTED.filter((t) => !names.includes(t));
    if (missing.length) {
        console.log("MISSING          : " + missing.join(", "));
        console.log("=> ยังไม่ได้รัน `npx prisma migrate deploy` กับ DATABASE_URL นี้");
        process.exitCode = 1;
    } else {
        console.log("OK               : ตารางครบตามที่คาดหวัง");
    }
} catch (error) {
    const message = String(error && error.message ? error.message : error).split("\n").slice(0, 3).join(" | ");
    console.log("ERROR            : " + message);
    process.exitCode = 1;
} finally {
    await db.$disconnect();
}
