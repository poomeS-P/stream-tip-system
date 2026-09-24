/**
 * E2E STEP 12–14 — จำลอง OBS Browser Source ผ่าน SSE
 *
 * รัน:
 *   npx tsx scripts/e2e/06-sse-client.ts                  # ฟัง 30 วินาที แล้วพิมพ์ event ที่ได้รับ
 *   npx tsx scripts/e2e/06-sse-client.ts --seconds 60
 *   npx tsx scripts/e2e/06-sse-client.ts --ack            # เมื่อได้ alert → ส่ง ACK กลับ และทดสอบ ACK แบบไม่มี token
 *   npx tsx scripts/e2e/06-sse-client.ts --no-token       # ตรวจว่าไม่มี token → 401
 *   npx tsx scripts/e2e/06-sse-client.ts --expect 2       # รอจนได้ alert ครบ 2 ครั้ง
 *   npx tsx scripts/e2e/06-sse-client.ts --role voice     # จำลองหน้าต่างอ่านเสียงของ Edge (ไม่ ACK, ไม่จองคิว)
 *   npx tsx scripts/e2e/06-sse-client.ts --role passive   # จำลองหน้าต่างที่แค่อ่าน event เช่นหน้า Podium (ไม่จองคิว)
 *   npx tsx scripts/e2e/06-sse-client.ts --role overlay   # จำลอง OBS Browser Source (ค่าเริ่มต้นเมื่อไม่ระบุ)
 *
 * หมายเหตุ: ไม่ระบุ --role = ไม่ส่งพารามิเตอร์ role (ทดสอบความเข้ากันได้กับ URL เดิม → server ถือเป็น overlay)
 *
 * ข้อจำกัด: เสียง Alert และ TTS (Web Speech API) ทำงานใน browser เท่านั้น
 * สคริปต์นี้ตรวจได้เฉพาะ payload (soundUrl / ttsEnabled) และไฟล์เสียงใน public/alerts
 * → ขั้นที่ 13 ต้องยืนยันด้วยตา/หูใน OBS Browser Source จริง
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  PROJECT_ROOT,
  baseUrl,
  fail,
  finish,
  httpRequest,
  info,
  loadEnvFile,
  pass,
  pickBoolean,
  pickNumber,
  pickString,
  readState,
  requireEnv,
  section,
  warn,
} from "./_shared";

interface Options {
  seconds: number;
  expect: number;
  ack: boolean;
  noToken: boolean;
  /** "voice"/"passive" = จำลองหน้าต่างที่ไม่ใช่ OBS · null = ไม่ส่งพารามิเตอร์ role (default ของ server = overlay) */
  role: "voice" | "passive" | null;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const seconds = Number(get("seconds") ?? 30);
  const expect = Number(get("expect") ?? 1);
  const role = get("role");

  return {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 30,
    expect: Number.isFinite(expect) && expect > 0 ? expect : 1,
    ack: args.includes("--ack"),
    noToken: args.includes("--no-token"),
    role: role === "voice" ? "voice" : role === "passive" ? "passive" : null,
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const options = parseArgs();

  section("STEP 13 (เตรียม) — ไฟล์เสียง Alert");
  const soundPath = path.join(PROJECT_ROOT, "public", "alerts", "alert.mp3");
  if (existsSync(soundPath)) {
    pass("พบไฟล์ public/alerts/alert.mp3 (เสียง Alert จะดังบน OBS)");
  } else {
    warn(
      "ยังไม่มี public/alerts/alert.mp3",
      "เสียง Alert จะไม่ดัง (TTS ยังทำงาน) — ดูคำแนะนำใน public/alerts/README.txt"
    );
  }

  const token = options.noToken ? "" : requireEnv("OVERLAY_TOKEN");
  const roleParam = options.role ? `&role=${options.role}` : "";
  const streamUrl = `${baseUrl()}/api/alerts/stream?token=${encodeURIComponent(token)}${roleParam}`;

  section("STEP 12 — เชื่อมต่อ SSE");
  if (options.noToken) {
    info("   ทดสอบกรณีไม่มี token");
  } else {
    info(`   url = ${streamUrl.replace(encodeURIComponent(token), "***")}`);
  info(`   role = ${options.role ?? "overlay (ค่าเริ่มต้น — ไม่ส่งพารามิเตอร์ role)"}`);
  }

  const res = await fetch(streamUrl);

  if (options.noToken) {
    if (res.status === 401) pass("ไม่มี token → 401 Unauthorized (ถูกต้อง)");
    else fail(`ไม่มี token แต่ได้ HTTP ${res.status}`, "คาดหวัง 401");
    finish();
    return;
  }

  if (res.status !== 200) {
    const body = (await res.text()).slice(0, 200);
    fail(`เชื่อมต่อ SSE ไม่ได้ (HTTP ${res.status})`, body);
    finish();
    return;
  }

  pass("เชื่อมต่อ SSE สำเร็จ (HTTP 200)");
  info(`   content-type = ${res.headers.get("content-type") ?? "-"}`);
  info(`   ฟังเป็นเวลา ${options.seconds} วินาที (รอ alert ${options.expect} ครั้ง)`);
  info("   → เปิดอีกหน้าต่างเพื่อส่ง Alert: กด 'ส่ง Test Alert' ใน /admin หรือยิง webhook");

  const reader = res.body?.getReader();
  if (!reader) {
    fail("อ่าน response body ไม่ได้");
    finish();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let alertCount = 0;
  const deadline = Date.now() + options.seconds * 1000;

  while (Date.now() < deadline && alertCount < options.expect) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));

      if (!eventLine || !dataLine) {
        // comment/heartbeat ของ SSE เช่น ": heartbeat"
        info(`   [keep-alive] ${lines[0]}`);
        continue;
      }

      const eventName = eventLine.slice("event:".length).trim();
      let payload: unknown = null;
      try {
        payload = JSON.parse(dataLine.slice("data:".length).trim());
      } catch {
        payload = null;
      }

      if (eventName === "alert") {
        alertCount += 1;
        pass(`ได้รับ event: alert (ครั้งที่ ${alertCount})`);
        info(`   alertId  = ${pickString(payload, "alertId") ?? "-"}`);
        info(`   tipId    = ${pickString(payload, "tipId") ?? "-"}`);
        info(
          `   donor    = ${pickString(payload, "donorName") ?? "-"} | amount = ${pickNumber(payload, "amount") ?? "-"} ${pickString(payload, "currency") ?? ""}`
        );
        info(`   message  = ${pickString(payload, "message") ?? ""}`);
        info(
          `   soundUrl = ${pickString(payload, "soundUrl") ?? "-"} | duration = ${pickNumber(payload, "durationSeconds") ?? "-"}s | ttsEnabled = ${pickBoolean(payload, "ttsEnabled") ?? false}`
        );
        info(
          "   → บน OBS ต้องเห็นการ์ด Alert ขึ้น + เสียง (ถ้ามี alert.mp3) + TTS อ่านข้อความ (ถ้า ttsEnabled)"
        );

        const alertId = pickString(payload, "alertId");
        if (options.ack && alertId) {
          const ackToken = requireEnv("OVERLAY_TOKEN");

          const withToken = await httpRequest(
            "POST",
            `${baseUrl()}/api/alerts/ack?token=${encodeURIComponent(ackToken)}`,
            { body: { alertId } }
          );
          if (withToken.status === 200) {
            pass("ACK พร้อม token สำเร็จ (HTTP 200) → ตรวจต่อ: 05-verify-db.ts --expect-ack");
          } else {
            fail(`ACK พร้อม token ล้มเหลว (HTTP ${withToken.status})`, withToken.text.slice(0, 160));
          }

          const withoutToken = await httpRequest("POST", `${baseUrl()}/api/alerts/ack`, {
            body: { alertId },
          });
          if (withoutToken.status === 401) {
            pass("ACK โดยไม่มี token → 401 (ถูกปฏิเสธตามที่ออกแบบ)");
          } else {
            fail(`ACK โดยไม่มี token ได้ HTTP ${withoutToken.status}`, "คาดหวัง 401");
          }
        }
      } else if (eventName === "presence") {
        pass("ได้รับ event: presence (จำนวน client แยกบทบาท)");
        info(
          `   overlay=${pickNumber(payload, "overlay") ?? "-"} · voice=${pickNumber(payload, "voice") ?? "-"} · total=${pickNumber(payload, "total") ?? "-"}`
        );
      } else if (eventName === "emergency") {
        pass("ได้รับ event: emergency (Emergency Kill Switch ส่งถึง overlay)");
        info(`   payload = ${JSON.stringify(payload)}`);
      } else {
        info(`   [${eventName}] ${JSON.stringify(payload)}`);
      }
    }
  }

  await reader.cancel();

  if (alertCount === 0) {
    fail(
      "ไม่ได้รับ Alert ภายในเวลาที่กำหนด",
      `ฟัง ${options.seconds}s — ลองเพิ่ม --seconds หรือส่ง Test Alert จาก Dashboard`
    );
  } else {
    pass(`ได้รับ Alert รวม ${alertCount} ครั้ง`);
  }

  const state = readState();
  if (state.alertId) info(`   alertId ล่าสุดใน state = ${state.alertId}`);

  finish();
}

void main();
