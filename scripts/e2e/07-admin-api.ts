/**
 * E2E STEP 15–16 — ทดสอบ Admin API และ Emergency Kill Switch
 *
 * รัน: npx tsx scripts/e2e/07-admin-api.ts
 *
 * สิ่งที่ตรวจ:
 *  15) GET /api/admin/tips (มี/ไม่มี token), POST /api/alerts/test
 *  16) POST /api/admin/emergency (ปิด → ตรวจ → เปิดคืน) พร้อมยืนยันว่าไม่ค้างสถานะปิดไว้
 *
 * หมายเหตุ: ระหว่างทดสอบ Emergency จะมี SSE event "emergency" broadcast ไปยัง overlay
 *          ถ้าต้องการเห็น event นั้น ให้รัน 06-sse-client.ts ไว้ก่อนสคริปต์นี้
 */

import {
  baseUrl,
  fail,
  finish,
  httpRequest,
  info,
  loadEnvFile,
  pass,
  pickBoolean,
  pickString,
  requireEnv,
  section,
  writeState,
} from "./_shared";

async function main(): Promise<void> {
  loadEnvFile();
  const adminToken = requireEnv("ADMIN_TOKEN");
  const authHeader = { Authorization: `Bearer ${adminToken}` };

  // ---------- STEP 15 ----------
  section("STEP 15 — Admin API");

  const noToken = await httpRequest("GET", `${baseUrl()}/api/admin/tips`);
  if (noToken.status === 401) pass("GET /api/admin/tips ไม่มี token → 401");
  else fail(`GET /api/admin/tips ไม่มี token ได้ HTTP ${noToken.status}`, "คาดหวัง 401");

  const tips = await httpRequest("GET", `${baseUrl()}/api/admin/tips?limit=5`, {
    headers: authHeader,
  });
  if (tips.status === 200) {
    pass("GET /api/admin/tips (มี token) → 200");
    const total = pickString(tips.json, "pagination");
    info(`   response keys: ${Object.keys(typeof tips.json === "object" && tips.json !== null ? tips.json : {}).join(", ")}`);
    if (total) info(`   pagination = ${JSON.stringify(total)}`);
  } else {
    fail(`GET /api/admin/tips (มี token) ได้ HTTP ${tips.status}`, tips.text.slice(0, 160));
  }

  const testAlert = await httpRequest("POST", `${baseUrl()}/api/alerts/test`, {
    headers: authHeader,
    body: { donorName: "E2E Test Alert", amount: 150, message: "ทดสอบ Alert จากสคริปต์ E2E" },
  });
  if (testAlert.status === 200) {
    const alertId = pickString(testAlert.json, "alertId");
    if (alertId) {
      writeState({ testAlertId: alertId });
      pass("POST /api/alerts/test → 200 (สร้าง Alert ทดสอบแล้ว)");
      info(`   testAlertId = ${alertId}`);
      info("   → overlay/SSE ต้องได้รับ alert นี้ทันที (ดู 06-sse-client.ts)");
    } else {
      fail("POST /api/alerts/test ตอบ 200 แต่ไม่มี alertId");
    }
  } else {
    fail(`POST /api/alerts/test ได้ HTTP ${testAlert.status}`, testAlert.text.slice(0, 160));
  }

  const settings = await httpRequest("GET", `${baseUrl()}/api/admin/settings`, {
    headers: authHeader,
  });
  if (settings.status === 200) pass("GET /api/admin/settings → 200 (Dashboard โหลดค่าได้)");
  else fail(`GET /api/admin/settings ได้ HTTP ${settings.status}`, settings.text.slice(0, 160));

  // ---------- STEP 16 ----------
  section("STEP 16 — Emergency Kill Switch");

  const before = await httpRequest("GET", `${baseUrl()}/api/admin/emergency`, {
    headers: authHeader,
  });
  const beforeAlert = pickBoolean(before.json, "emergencyAlertMuted");
  const beforeTts = pickBoolean(before.json, "emergencyTTSMuted");
  info(`   สถานะเริ่มต้น: alertMuted=${String(beforeAlert)} ttsMuted=${String(beforeTts)}`);

  try {
    const mute = await httpRequest("POST", `${baseUrl()}/api/admin/emergency`, {
      headers: authHeader,
      body: { alertMuted: true, ttsMuted: true },
    });
    if (mute.status === 200) pass("POST /api/admin/emergency (ปิด Alert+TTS) → 200");
    else fail(`POST /api/admin/emergency ได้ HTTP ${mute.status}`, mute.text.slice(0, 160));

    const muted = await httpRequest("GET", `${baseUrl()}/api/admin/emergency`, {
      headers: authHeader,
    });
    const mutedAlert = pickBoolean(muted.json, "emergencyAlertMuted");
    const mutedTts = pickBoolean(muted.json, "emergencyTTSMuted");
    if (mutedAlert === true && mutedTts === true) {
      pass("สถานะหลังปิด = alertMuted:true, ttsMuted:true (บันทึกลง DB แล้ว)");
      info("   → overlay ต้องได้รับ SSE event 'emergency' และหยุด Alert/TTS ทันที (ดู 06-sse-client.ts)");
    } else {
      fail("สถานะหลังปิดไม่ตรง", `alertMuted=${String(mutedAlert)} ttsMuted=${String(mutedTts)}`);
    }

    const unmute = await httpRequest("POST", `${baseUrl()}/api/admin/emergency`, {
      headers: authHeader,
      body: { alertMuted: false, ttsMuted: false },
    });
    if (unmute.status === 200) pass("POST /api/admin/emergency (เปิดคืน) → 200");
    else fail(`เปิดคืนได้ HTTP ${unmute.status}`, unmute.text.slice(0, 160));
  } finally {
    // ยืนยันว่าไม่ค้างสถานะปิดไว้
    const restored = await httpRequest("POST", `${baseUrl()}/api/admin/emergency`, {
      headers: authHeader,
      body: {
        alertMuted: beforeAlert ?? false,
        ttsMuted: beforeTts ?? false,
      },
    });
    const finalState = await httpRequest("GET", `${baseUrl()}/api/admin/emergency`, {
      headers: authHeader,
    });
    info(
      `   สถานะสุดท้าย: alertMuted=${String(pickBoolean(finalState.json, "emergencyAlertMuted"))} ttsMuted=${String(pickBoolean(finalState.json, "emergencyTTSMuted"))} (restore HTTP ${restored.status})`
    );
    if (
      pickBoolean(finalState.json, "emergencyAlertMuted") === (beforeAlert ?? false) &&
      pickBoolean(finalState.json, "emergencyTTSMuted") === (beforeTts ?? false)
    ) {
      pass("คืนค่า Emergency กลับเป็นสถานะเดิมเรียบร้อย");
    } else {
      fail("Emergency ไม่กลับเป็นสถานะเดิม", "ตรวจสอบ /admin หรือรันสคริปต์ซ้ำ");
    }
  }

  finish();
}

void main();
