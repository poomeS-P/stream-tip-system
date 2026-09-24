/**
 * ตรวจระบบ "เสียงอ่านข้อความ" (TTS) ของหน้า Overlay
 * รัน: npx tsx scripts/tts-preview.ts
 *
 * ตรวจแบบไม่ต้องเปิดเบราว์เซอร์/OBS เพราะทุกอย่างเป็น pure function:
 *   1) อ่านจำนวนเงินเป็นคำไทย (300 → "สามร้อยบาท" · 25.50 → "ยี่สิบห้าบาทห้าสิบสตางค์")
 *   2) ทำข้อความให้พร้อมอ่าน (ตัด emoji / ★ / URL / @mention, ตัด comma หลักพัน)
 *   3) ประกอบข้อความอ่านเต็มประโยค
 *   4) เลือกเสียงไทยที่เหมาะที่สุดจากรายชื่อเสียงของเครื่อง (หญิง > ชาย)
 *   5) อ่านค่าปรับจาก URL (?ttsvoice= ?ttsrate= ?ttspitch= ?ttsdiag=1)
 *
 * ไม่แตะฐานข้อมูล และไม่กระทบระบบอื่น — เป็นสคริปต์ตรวจอ่านล้วน ๆ
 */

import {
  DEFAULT_TTS_PITCH,
  DEFAULT_TTS_RATE,
  buildVoiceDiag,
  classifyVoiceSystem,
  formatTtsDecision,
  planSpeech,
  planTts,
  resolveTtsConfig,
} from "../src/lib/tts/speech-engine";
import { buildSpeechText, sanitizeForSpeech, thaiBahtToWords } from "../src/lib/tts/speech-text";
import { isLikelyMaleVoice, pickThaiVoice, type SpeechVoiceInfo } from "../src/lib/tts/voice";

let passed = 0;
let failed = 0;

function check(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed += 1;
    console.log(`  [PASS] ${label} → "${actual}"`);
    return;
  }

  failed += 1;
  console.log(`  [FAIL] ${label}\n         ได้:      "${actual}"\n         ต้องเป็น: "${expected}"`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

const voice = (
  name: string,
  lang: string,
  localService: boolean,
  isDefault = false
): SpeechVoiceInfo => ({ name, lang, localService, default: isDefault });

section("1) อ่านจำนวนเงินเป็นคำไทย");
check("1 บาท", thaiBahtToWords(1), "หนึ่งบาท");
check("10 บาท", thaiBahtToWords(10), "สิบบาท");
check("11 บาท", thaiBahtToWords(11), "สิบเอ็ดบาท");
check("20 บาท", thaiBahtToWords(20), "ยี่สิบบาท");
check("21 บาท", thaiBahtToWords(21), "ยี่สิบเอ็ดบาท");
check("100 บาท", thaiBahtToWords(100), "หนึ่งร้อยบาท");
check("101 บาท", thaiBahtToWords(101), "หนึ่งร้อยเอ็ดบาท");
check("300 บาท", thaiBahtToWords(300), "สามร้อยบาท");
check("1,000 บาท", thaiBahtToWords(1000), "หนึ่งพันบาท");
check("1,234 บาท", thaiBahtToWords(1234), "หนึ่งพันสองร้อยสามสิบสี่บาท");
check("10,000 บาท", thaiBahtToWords(10000), "หนึ่งหมื่นบาท");
check("100,000 บาท", thaiBahtToWords(100000), "หนึ่งแสนบาท");
check("1,000,000 บาท", thaiBahtToWords(1000000), "หนึ่งล้านบาท");
check("1,500,000 บาท", thaiBahtToWords(1500000), "หนึ่งล้านห้าแสนบาท");
check("0.50 บาท", thaiBahtToWords(0.5), "ห้าสิบสตางค์");
check("25.50 บาท", thaiBahtToWords(25.5), "ยี่สิบห้าบาทห้าสิบสตางค์");
check("99.99 บาท", thaiBahtToWords(99.99), "เก้าสิบเก้าบาทเก้าสิบเก้าสตางค์");

section("2) ทำข้อความให้พร้อมอ่าน");
check("ตัด emoji", sanitizeForSpeech("ขอบคุณครับ 🎉💜"), "ขอบคุณครับ");
check("ตัดเครื่องหมายคำที่ถูกกรอง (★)", sanitizeForSpeech("ข้อความ ★★★ นี้"), "ข้อความ นี้");
check("ตัด URL", sanitizeForSpeech("ไปที่ https://example.com/page ครับ"), "ไปที่ ครับ");
check("ตัด @mention", sanitizeForSpeech("ขอบคุณ @someuser ครับ"), "ขอบคุณ ครับ");
check("ตัด comma หลักพัน", sanitizeForSpeech("ยอด 1,000 บาท"), "ยอด 1000 บาท");
check("ทศนิยมในข้อความยังอยู่", sanitizeForSpeech("ยอด 25.50 บาท"), "ยอด 25.50 บาท");
check("ข้อความว่าง", sanitizeForSpeech("   "), "");

section("3) ประกอบข้อความอ่านเต็มประโยค");
check(
  "ชื่อ + ยอด + ข้อความ",
  buildSpeechText({
    donorName: "คุณภูมิ",
    amount: 100,
    message: "ขอบคุณสำหรับการสนับสนุนครับ",
  }),
  "คุณภูมิ สนับสนุนจำนวน หนึ่งร้อยบาท, ขอบคุณสำหรับการสนับสนุนครับ"
);
check(
  "ไม่มีข้อความ",
  buildSpeechText({ donorName: "คุณภูมิ", amount: 300, message: null }),
  "คุณภูมิ สนับสนุนจำนวน สามร้อยบาท"
);
check(
  "ผู้ไม่ประสงค์ออกนาม",
  buildSpeechText({ donorName: "ผู้ไม่ประสงค์ออกนาม", amount: 20, message: "สู้ๆนะ 💪" }),
  "ผู้ไม่ประสงค์ออกนาม สนับสนุนจำนวน ยี่สิบบาท, สู้ๆนะ"
);

section("4) เลือกเสียงไทยที่เหมาะที่สุด");
const edgeVoices: SpeechVoiceInfo[] = [
  voice("Google US English", "en-US", false),
  voice("Microsoft David - English (United States)", "en-US", true, true),
  voice("Microsoft Pattara - Thai (Thailand)", "th-TH", true),
  voice("Microsoft เปรมวดี Online (Natural) - Thai (Thailand)", "th-TH", false),
  voice("Microsoft นิวัฒน์ Online (Natural) - Thai (Thailand)", "th-TH", false),
];
const pickedEdge = pickThaiVoice(edgeVoices);
check(
  "เครื่องแบบ Edge (มีเสียงหญิงธรรมชาติ)",
  pickedEdge?.name ?? "-",
  "Microsoft เปรมวดี Online (Natural) - Thai (Thailand)"
);
check("ไม่ใช่เสียงผู้ชาย", String(isLikelyMaleVoice(pickedEdge)), "false");

const cefVoices: SpeechVoiceInfo[] = [
  voice("Microsoft David - English (United States)", "en-US", true, true),
  voice("Microsoft Zira - English (United States)", "en-US", true),
  voice("Microsoft Pattara - Thai (Thailand)", "th-TH", true),
];
const pickedCef = pickThaiVoice(cefVoices);
check(
  "เครื่องแบบ OBS/CEF (มีแต่เสียงไทยผู้ชาย)",
  pickedCef?.name ?? "-",
  "Microsoft Pattara - Thai (Thailand)"
);
check("ตรวจพบว่าเป็นเสียงผู้ชาย", String(isLikelyMaleVoice(pickedCef)), "true");

const pickedNone = pickThaiVoice([voice("Microsoft Zira - English (United States)", "en-US", true)]);
check("เครื่องที่ไม่มีเสียงไทยเลย", String(pickedNone), "null");
check(
  "บังคับชื่อเสียงเองด้วยชื่อไทย (?ttsvoice=นิวัฒน์)",
  pickThaiVoice(edgeVoices, "นิวัฒน์")?.name ?? "-",
  "Microsoft นิวัฒน์ Online (Natural) - Thai (Thailand)"
);
check(
  "บังคับชื่อเสียงเองด้วยชื่ออังกฤษ (?ttsvoice=pattara)",
  pickThaiVoice(cefVoices, "pattara")?.name ?? "-",
  "Microsoft Pattara - Thai (Thailand)"
);

section("5) อ่านค่าปรับจาก URL");
const defaults = resolveTtsConfig("");
check("rate เริ่มต้น", String(defaults.rate), String(DEFAULT_TTS_RATE));
check("pitch เริ่มต้น", String(defaults.pitch), String(DEFAULT_TTS_PITCH));
check("diag ปิดโดยค่าเริ่มต้น", String(defaults.diag), "false");

const tuned = resolveTtsConfig("?ttsrate=0.92&ttspitch=1.12&ttsvoice=premwadee&ttsdiag=1");
check("ระบุ rate เอง", String(tuned.rate), "0.92");
check("ระบุ pitch เอง", String(tuned.pitch), "1.12");
check("ระบุชื่อเสียงเอง", String(tuned.voiceName), "premwadee");
check("เปิด diag", String(tuned.diag), "true");

const invalid = resolveTtsConfig("?ttsrate=9&ttspitch=abc");
check("rate ที่เกินช่วง → ใช้ค่าเริ่มต้น", String(invalid.rate), String(DEFAULT_TTS_RATE));
check("pitch ที่ไม่ใช่ตัวเลข → ใช้ค่าเริ่มต้น", String(invalid.pitch), String(DEFAULT_TTS_PITCH));

section("6) แผนการอ่าน + แผง diag (ตัวอย่าง)");
const plan = planSpeech(
  { donorName: "คุณภูมิ", amount: 100, message: "ขอบคุณสำหรับการสนับสนุนครับ" },
  edgeVoices,
  defaults
);
console.log(`  ข้อความที่จะอ่าน: ${plan.text}`);
console.log(`  เสียงที่เลือก:   ${plan.voiceName}`);
for (const line of buildVoiceDiag(edgeVoices, defaults, plan.voice)) {
  console.log(`  | ${line}`);
}

section("7) ตัวอย่างจากเครื่องที่ไม่มีเสียงไทย (ต้องเตือนใน diag)");
for (const line of buildVoiceDiag(cefVoices, defaults, pickedCef)) {
  console.log(`  | ${line}`);
}

section("8) โหมดตัวอ่านเสียงจาก URL (?tts= / ?tts=local / ?tts=0)");
const ttsDefault = resolveTtsConfig("");
check("ไม่ระบุ ?tts → เปิด + โหมด auto", `${ttsDefault.enabled}/${ttsDefault.mode}`, "true/auto");
check("?tts=1 → เปิด + โหมด auto", `${resolveTtsConfig("?tts=1").enabled}/${resolveTtsConfig("?tts=1").mode}`, "true/auto");
check("?tts=local → เปิด + โหมด local (บังคับอ่านจากหน้านี้)", `${resolveTtsConfig("?tts=local").enabled}/${resolveTtsConfig("?tts=local").mode}`, "true/local");
check("?tts=0 → ปิด", `${resolveTtsConfig("?tts=0").enabled}/${resolveTtsConfig("?tts=0").mode}`, "false/auto");
check("?ttsvoice= ยังใช้ได้เหมือนเดิม", String(resolveTtsConfig("?ttsvoice=premwadee").voiceName), "premwadee");
check("?ttsdiag=1 ยังใช้ได้เหมือนเดิม", String(resolveTtsConfig("?ttsdiag=1").diag), "true");

section("9) ตัดสินใจอ่านเสียง (planTts) — Edge เป็นตัวอ่านหลัก + fallback");
const edgeFemale = edgeVoices.find((v) => v.name.includes("เปรมวดี")) ?? null;
check("จำแนกระบบเสียง: Edge Thai female", classifyVoiceSystem(edgeFemale).system, "edge-online-thai-female");
check("จำแนกระบบเสียง: Windows Thai male", classifyVoiceSystem(voice("Microsoft Pattara - Thai (Thailand)", "th-TH", true)).system, "local-thai-male");
check("จำแนกระบบเสียง: ไม่มีเสียงไทย", classifyVoiceSystem(null).system, "browser-default");

const decide = (overrides: Partial<Parameters<typeof planTts>[0]>) =>
  planTts({
    payloadTtsEnabled: true,
    config: defaults,
    emergencyTtsMuted: false,
    speechSynthesisAvailable: true,
    externalVoiceClients: 0,
    voices: edgeVoices,
    ...overrides,
  });

const edgeSpeak = decide({});
check("Edge มีเสียงหญิง + ไม่มีตัวอ่านอื่น → อ่านด้วยเสียงหญิง (ไม่ fallback)", `${edgeSpeak.action}/${edgeSpeak.system}/fallback=${edgeSpeak.fallbackUsed}`, "speak/edge-online-thai-female/fallback=false");
check("ข้อความ log ของกรณีนี้", edgeSpeak.voiceName ?? "-", "Microsoft เปรมวดี Online (Natural) - Thai (Thailand) [th-TH]");

const cefOnly = decide({ voices: cefVoices });
check("OBS/CEF มีแต่ Pattara → อ่านได้แต่เป็น fallback", `${cefOnly.action}/${cefOnly.system}/fallback=${cefOnly.fallbackUsed}`, "speak/local-thai-male/fallback=true");

const withExternal = decide({ voices: cefVoices, externalVoiceClients: 1 });
check("มีตัวอ่านภายนอก (Edge) + โหมด auto → หน้าต่าง OBS skip", `${withExternal.action}/${withExternal.reasonCode}/${withExternal.primary}`, "skip/external-voice-client/external-voice-client");

const forced = decide({ voices: cefVoices, externalVoiceClients: 1, config: { ...defaults, mode: "local" } });
check("?tts=local → บังคับอ่านจากหน้านี้แม้ Edge เปิดอยู่", `${forced.action}/${forced.system}`, "speak/local-thai-male");

const off = decide({ config: { ...defaults, enabled: false } });
check("?tts=0 → skip", `${off.action}/${off.reasonCode}`, "skip/window-tts-off");

const lowAmount = decide({ payloadTtsEnabled: false });
check("server ส่ง ttsEnabled=false → skip", `${lowAmount.action}/${lowAmount.reasonCode}`, "skip/tts-disabled-by-amount");

const emergency = decide({ emergencyTtsMuted: true });
check("Emergency TTS → skip", `${emergency.action}/${emergency.reasonCode}`, "skip/emergency-tts-muted");

const noSynth = decide({ speechSynthesisAvailable: false });
check("ไม่มี speechSynthesis → skip (ไม่ทำให้การ์ดพัง)", `${noSynth.action}/${noSynth.reasonCode}`, "skip/no-speech-synthesis");

const noThai = decide({ voices: [voice("Microsoft Zira - English (United States)", "en-US", true)] });
check("ไม่มีเสียงไทยเลย → อ่านด้วยเสียง default (fallback)", `${noThai.action}/${noThai.system}/fallback=${noThai.fallbackUsed}`, "speak/browser-default/fallback=true");

const preferPremwadee = decide({ config: { ...defaults, voiceName: "premwadee" } });
check("?ttsvoice=premwadee ยังบังคับเสียงได้", preferPremwadee.system, "edge-online-thai-female");

section("10) บรรทัด log ที่ใช้วินิจฉัย (formatTtsDecision)");
const logEdge = formatTtsDecision(edgeSpeak);
const logSkip = formatTtsDecision(withExternal);
console.log(`  ${logEdge}`);
console.log(`  ${logSkip}`);
check("log กรณีอ่านด้วย Edge ระบุระบบเสียง", String(logEdge.includes("system=edge-online-thai-female")), "true");
check("log กรณีอ่านด้วย Edge ระบุ fallback=no", String(logEdge.includes("fallback=no")), "true");
check("log กรณี fallback ระบุ fallback=yes", String(formatTtsDecision(cefOnly).includes("fallback=yes")), "true");
check("log กรณี skip ระบุเหตุผล + ตัวอ่านภายนอก", String(logSkip.includes("primary=external-voice-client") && logSkip.includes("external-voice-client")), "true");

console.log(`\nสรุป: ผ่าน ${passed} · ไม่ผ่าน ${failed}`);
if (failed > 0) {
  console.error("❌ ตรวจไม่ผ่าน — ดูรายการ [FAIL] ด้านบน");
  process.exit(1);
}
console.log("✅ ตรวจผ่านทั้งหมด");
