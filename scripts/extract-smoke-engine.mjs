/**
 * extract-smoke-engine.mjs — sync เอนจินควันจาก "ระบบเก่า" มาเป็นไฟล์ใช้ร่วม
 *
 * ต้นทาง : ../poomes-stream-system/views/alert.html
 *            helper query 1429-1443 · config (SMOKE_FAMILIES..SMOKE_ACTIVE) 1677-1729 · engine 1730-2639
 * ปลายทาง: public/smoke/smoke-engine.js  (ใช้โดย src/components/overlay/SmokeBackdrop.tsx)
 *
 * ทำไมต้อง sync: การ์ดโดเนทต้องใช้ควัน "ลุคเดียวกับแจ้งเตือน Follow" เป๊ะ
 * -> ไม่เขียนศิลป์ใหม่ แต่ดึงโค้ดจริงมาใช้ (ถ้าแก้เอนจินที่ระบบเก่า ให้รันสคริปต์นี้ซ้ำ)
 *
 * รัน: node scripts/extract-smoke-engine.mjs [path/to/alert.html] [path/to/out.js]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const SRC = path.resolve(process.argv[2] || path.join(repoRoot, "..", "poomes-stream-system", "views", "alert.html"));
const OUT = path.resolve(process.argv[3] || path.join(repoRoot, "public", "smoke", "smoke-engine.js"));

const LINES = { helperFrom: 1429, helperTo: 1443, configFrom: 1677, configTo: 1729, engineFrom: 1730, engineTo: 2639 };

const raw = fs.readFileSync(SRC, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/);

/** ตัดบรรทัดแบบ 1-based รวมปลายทั้งสองข้าง */
const slice = (from, to) => lines.slice(from - 1, to).join("\n");

const helpers = slice(LINES.helperFrom, LINES.helperTo);
const config = slice(LINES.configFrom, LINES.configTo);
const engine = slice(LINES.engineFrom, LINES.engineTo);

if (!/var Smoke = \(function/.test(engine)) {
    throw new Error(`ไม่พบ IIFE ของ Smoke ใน ${SRC} (บรรทัด ${LINES.engineFrom}-${LINES.engineTo}) — ต้นทางอาจถูกแก้ ให้ตรวจเลขบรรทัดใหม่`);
}

// ตัวแปรที่อ้างถึงแต่อยู่นอกช่วงที่ดึงมา (ต้องมีใน prelude) — ที่เหลือแปลว่าเลขบรรทัดเลื่อน
const OUTSIDE = /\b(cfgAny|cfg|DEFAULTS|CFG|MAX_VISIBLE|DISPLAY_MS|GAP_PX|REDUCE_MOTION|FORCE_MOTION)\b/g;
const externalRefs = {};
for (const match of (engine + config).matchAll(OUTSIDE)) {
    externalRefs[match[1]] = (externalRefs[match[1]] || 0) + 1;
}

const header = `/**
 * smoke-engine.js — เอนจินควันรอบกรอบข้อความ (สไปรต์ 3 ระนาบ + enter/idle/exit)
 *
 * ไฟล์นี้ "ดึงมาตรง ๆ" จากระบบเก่า เพื่อให้การ์ดโดเนทของระบบใหม่ใช้ควันลุคเดียวกับ
 * การ์ดแจ้งเตือน Follow เป๊ะ (ไม่มีการเขียนศิลป์ใหม่ -> ไม่คลาดเคลื่อน)
 *
 *   ต้นทาง : poomes-stream-system/views/alert.html
 *            helper query ${LINES.helperFrom}-${LINES.helperTo} · config ${LINES.configFrom}-${LINES.configTo} · engine ${LINES.engineFrom}-${LINES.engineTo}
 *   สัญญา : window.StreamSmoke = { spawn, release, warm, remeasure, rebuild, debug }
 *            StreamSmoke.spawn(canvasEl, textEl, fill?) -> instance
 *            instance.phase = "idle" | "exit"           (ผู้เรียกเป็นคนสั่งเปลี่ยนเฟส)
 *            StreamSmoke.release(instance)              -> ตัดออกจาก loop ทันที
 *
 *   CSS ที่ต้องมีคู่กัน (คัดจาก alert.html บรรทัด 161-183):
 *            canvas อยู่หลังข้อความ (z-index 0) ขอบกว้างกว่ากรอบข้อความ 128% x 152%
 *            + mask radial-gradient ให้ขอบนอกสุดจางหาย (ห้ามแตะขอบแข็ง -> กันเห็นกรอบสี่เหลี่ยม)
 *
 *   URL query: ?smoke=A1..C3 (พรีเซ็ต) · ?enterMs= ?exitMs= · ?smokedev=1
 *
 * ⚠️ ไฟล์นี้ถูก generate — แก้ที่ alert.html แล้วรัน scripts/extract-smoke-engine.mjs
 */
`;

const prelude = `(function (global) {
    var location = global.location;   // เอนจินอ่าน query จาก URL ของหน้า overlay

${helpers}

    /* ระยะเวลา enter/exit ของควัน (ระบบเก่าดึงจาก config; ที่นี่รับจาก query แทน) */
    var ENTER_MS = queryNumber("enterMs", 1100);
    var EXIT_MS = queryNumber("exitMs", 800);

${config}

${engine}

    global.StreamSmoke = Smoke;
})(window);
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + prelude, "utf8");

console.log(`[in ] ${SRC}`);
console.log(`[out] ${OUT} (${Buffer.byteLength(header + prelude)} bytes, ${(header + prelude).split(/\n/).length} บรรทัด)`);
console.log(`[check] externalRefs = ${JSON.stringify(externalRefs)} (ควรว่าง)`);
