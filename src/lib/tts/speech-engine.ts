/**
 * ตัวขับเคลื่อนเสียงอ่าน (Speech Engine) สำหรับหน้า Overlay
 *
 * รวมจุดเดียวที่แตะ Web Speech API:
 *   - อ่านค่าปรับจาก URL: ?ttsvoice= ?ttsrate= ?ttspitch= ?ttsdiag=1
 *   - โหลดรายชื่อเสียง (บางเบราว์เซอร์ส่ง list ว่างก่อน แล้วค่อยยิง voiceschanged)
 *   - เลือกเสียงไทยที่เหมาะที่สุด (ดู src/lib/tts/voice.ts) แล้วพูดด้วยค่านั้น
 *
 * ไม่แตะตรรกะอื่นของ Overlay (คิว/ACK/Emergency/ระยะเวลาบนจอ)
 */

import {
  isLikelyFemaleVoice,
  isLikelyMaleVoice,
  isNaturalVoice,
  pickThaiVoice,
  rankVoices,
  toVoiceInfoList,
  type SpeechVoiceInfo,
} from "./voice";
import { buildSpeechText, type SpeechTextInput } from "./speech-text";

/** ความเร็วกลาง ๆ นุ่มนวล (ไม่เร็วแบบอ่านอัตโนมัติ · ไม่ช้าแบบอ่านให้เด็ก) */
export const DEFAULT_TTS_RATE = 0.98;

/** ระดับเสียงสูงต่ำ — เพิ่มเล็กน้อยให้ฟังนุ่มนวล/เป็นมิตร (ไม่หลอกหู) */
export const DEFAULT_TTS_PITCH = 1.08;

const MIN_RATE = 0.5;
const MAX_RATE = 1.6;
const VOICE_LOAD_TIMEOUT_MS = 3000;

/** โหมดเลือก "ตัวอ่านเสียง" ของหน้าต่างหนึ่ง */
export type TtsMode = "auto" | "local";

export interface TtsConfig {
  /** ชื่อเสียงที่ผู้ใช้บังคับเอง (?ttsvoice=) — null = เลือกอัตโนมัติ */
  voiceName: string | null;
  rate: number;
  pitch: number;
  /** true = แสดงแผงรายชื่อเสียงบนจอ (?ttsdiag=1) */
  diag: boolean;
  /**
   * false = ปิดการอ่านเสียงของ "หน้าต่างนี้" (?tts=0)
   * ใช้เมื่อต้องรันคู่กับโหมดอ่านเสียงเท่านั้น (Edge) เพื่อไม่ให้อ่านซ้ำสองเสียง
   * — ไม่กระทบเสียง Alert (alert.mp3) และไม่กระทบค่าตั้งฝั่ง Server (ttsEnabled/minAmountForTTS)
   */
  enabled: boolean;
  /**
   * โหมดเลือกตัวอ่านเสียงของหน้าต่างนี้
   * - "auto" (ค่าเริ่มต้น) = ถ้ามีหน้าต่างอ่านเสียงภายนอก (Edge `/overlay/voice`) เชื่อมต่ออยู่
   *   หน้าต่างนี้จะ **ไม่** อ่านเอง เพื่อให้เสียงหญิงของ Edge เป็นตัวอ่านหลัก
   * - "local" (`?tts=local`) = บังคับให้หน้าต่างนี้อ่านเอง แม้มีตัวอ่านภายนอกเชื่อมต่ออยู่
   */
  mode: TtsMode;
}

/** อ่านค่าปรับจาก query string ของหน้า Overlay */
export function resolveTtsConfig(search: string): TtsConfig {
  const params = new URLSearchParams(search);
  const rate = Number(params.get("ttsrate"));
  const pitch = Number(params.get("ttspitch"));
  const ttsParam = params.get("tts");

  return {
    voiceName: params.get("ttsvoice"),
    rate: Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE ? rate : DEFAULT_TTS_RATE,
    pitch:
      Number.isFinite(pitch) && pitch >= MIN_RATE && pitch <= MAX_RATE
        ? pitch
        : DEFAULT_TTS_PITCH,
    diag: params.get("ttsdiag") === "1",
    // "0" = ปิด, "local" = บังคับอ่านจากหน้านี้, ค่าอื่น/ไม่ระบุ = เปิดในโหมด auto
    enabled: ttsParam !== "0",
    mode: ttsParam === "local" ? "local" : "auto",
  };
}

/**
 * ดึงรายชื่อเสียงที่ใช้ได้ (แปลงเป็นโครงสร้างของเรา)
 * บางเบราว์เซอร์ (รวมถึง Chromium ที่ใช้ใน OBS) คืน list ว่างในครั้งแรก
 * แล้วยิง event "voiceschanged" ตามหลัง จึงต้องรอสั้น ๆ ก่อนตัดสินใจ
 */
export async function loadAvailableVoices(
  synth: SpeechSynthesis,
  timeoutMs = VOICE_LOAD_TIMEOUT_MS
): Promise<SpeechVoiceInfo[]> {
  const immediate = toVoiceInfoList(synth.getVoices());
  if (immediate.length > 0) return immediate;

  return new Promise<SpeechVoiceInfo[]>((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(toVoiceInfoList(synth.getVoices()));
    };

    synth.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

export interface SpeechPlan {
  text: string;
  voice: SpeechVoiceInfo | null;
  voiceName: string | null;
}

/** เตรียมแผนการอ่าน (ข้อความ + เสียงที่จะใช้) — แยกออกมาเพื่อให้ตรวจสอบได้ */
export function planSpeech(
  input: SpeechTextInput,
  voices: readonly SpeechVoiceInfo[],
  config: TtsConfig
): SpeechPlan {
  const voice = pickThaiVoice(voices, config.voiceName);

  return {
    text: buildSpeechText(input),
    voice,
    voiceName: voice ? `${voice.name} [${voice.lang}]` : null,
  };
}

/**
 * พูดข้อความหนึ่งครั้ง (ยกเลิกเสียงที่ค้างอยู่ก่อนเสมอ)
 * คืน utterance เพื่อให้ผู้เรียกเก็บ ref และเรียก cancel() ได้
 */
export function speakText(
  synth: SpeechSynthesis,
  text: string,
  voice: SpeechVoiceInfo | null,
  config: TtsConfig
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "th-TH";
  utterance.rate = config.rate;
  utterance.pitch = config.pitch;
  utterance.volume = 1;

  if (voice) {
    // จับคู่ object จริงจากเบราว์เซอร์ (บางเบราว์เซอร์ต้องใช้ instance เดิมเท่านั้น)
    const matched = synth.getVoices().find((item) => item.name === voice.name);
    if (matched) utterance.voice = matched;
  }

  synth.cancel();
  synth.speak(utterance);

  return utterance;
}

/** ระบบเสียงที่หน้าต่างหนึ่งกำลังใช้จริง — ใช้รายงานผลและตัดสินใจ fallback */
export type VoiceSystem =
  | "edge-online-thai-female"
  | "online-thai"
  | "local-thai-female"
  | "local-thai-male"
  | "local-thai"
  | "browser-default";

export interface VoiceSystemInfo {
  system: VoiceSystem;
  label: string;
  /** true = เป้าหมายหลัก (เสียงหญิงไทยธรรมชาติของ Edge) */
  isPreferred: boolean;
  /** true = ต้องใช้เสียงสำรอง (Windows/Pattara หรือ default ของเบราว์เซอร์) */
  isFallback: boolean;
}

/**
 * จำแนก "ระบบเสียง" ของเสียงที่เลือกได้ — จุดเดียวของตรรกะนี้ในระบบ
 * เป้าหมายหลัก = online natural Thai female (เสียงหญิงธรรมชาติของ Edge)
 */
export function classifyVoiceSystem(voice: SpeechVoiceInfo | null): VoiceSystemInfo {
  if (!voice) {
    return {
      system: "browser-default",
      label: "browser default (ไม่พบเสียงไทยในเบราว์เซอร์นี้)",
      isPreferred: false,
      isFallback: true,
    };
  }

  const female = isLikelyFemaleVoice(voice);
  const natural = isNaturalVoice(voice);
  const online = !voice.localService;

  if (natural && online && female) {
    return {
      system: "edge-online-thai-female",
      label: `Edge/online natural Thai female — ${voice.name}`,
      isPreferred: true,
      isFallback: false,
    };
  }

  if (natural && online) {
    return {
      system: "online-thai",
      label: `online natural Thai (ยังไม่ยืนยันว่าเป็นเสียงหญิง) — ${voice.name}`,
      isPreferred: false,
      isFallback: false,
    };
  }

  if (female) {
    return {
      system: "local-thai-female",
      label: `Windows local Thai female — ${voice.name}`,
      isPreferred: false,
      isFallback: false,
    };
  }

  if (isLikelyMaleVoice(voice)) {
    return {
      system: "local-thai-male",
      label: `Windows local Thai male — ${voice.name}`,
      isPreferred: false,
      isFallback: true,
    };
  }

  return {
    system: "local-thai",
    label: `Thai voice (ไม่ทราบเพศจากชื่อ) — ${voice.name}`,
    isPreferred: false,
    isFallback: false,
  };
}

/** รหัสเหตุผลของการตัดสินใจ (ใช้ log/diag และทดสอบ) */
export type TtsReasonCode =
  | "speak"
  | "tts-disabled-by-amount"
  | "window-tts-off"
  | "emergency-tts-muted"
  | "external-voice-client"
  | "no-speech-synthesis";

export interface TtsDecision {
  action: "speak" | "skip";
  reasonCode: TtsReasonCode;
  reason: string;
  /** ใครเป็นคนอ่าน: หน้าต่างนี้ หรือตัวอ่านเสียงภายนอก (Edge /overlay/voice) */
  primary: "this-window" | "external-voice-client";
  voice: SpeechVoiceInfo | null;
  voiceName: string | null;
  system: VoiceSystem;
  systemLabel: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

export interface TtsDecisionInput {
  /** ค่าที่ server ส่งมากับ alert (ยอดโดเนทผ่านเกณฑ์อ่านเสียงไหม) */
  payloadTtsEnabled: boolean;
  config: TtsConfig;
  /** Emergency TTS ปิดอยู่ (จาก SSE event "emergency") */
  emergencyTtsMuted: boolean;
  /** เบราว์เซอร์นี้มี speechSynthesis ไหม */
  speechSynthesisAvailable: boolean;
  /** จำนวนหน้าต่างอ่านเสียงภายนอก (Edge /overlay/voice → role=voice) ที่เชื่อมต่ออยู่ */
  externalVoiceClients: number;
  voices: readonly SpeechVoiceInfo[];
}

/**
 * ตัดสินใจ "อ่าน/ไม่อ่าน" ของหน้าต่างหนึ่ง + บอกว่าใช้ระบบเสียงไหน/fallback เพราะอะไร
 *
 * เป็น pure function (ไม่แตะ DOM) → ทดสอบได้ด้วย `npx tsx scripts/tts-preview.ts`
 *
 * ลำดับความสำคัญ:
 *   1) server ส่ง ttsEnabled=false (ยอดไม่ถึงเกณฑ์) → skip
 *   2) หน้าต่างนี้ปิดเสียง (?tts=0)                  → skip
 *   3) Emergency TTS ปิดอยู่                        → skip
 *   4) มีตัวอ่านเสียงภายนอก (Edge) เชื่อมต่ออยู่     → skip ให้ Edge อ่าน (เว้นแต่ ?tts=local)
 *   5) เบราว์เซอร์ไม่รองรับ speechSynthesis          → skip
 *   6) อ่านจากหน้าต่างนี้ด้วยเสียงที่ดีที่สุด — ถ้าไม่มีเสียงหญิงธรรมชาติ = fallback
 */
export function planTts(input: TtsDecisionInput): TtsDecision {
  const voice = pickThaiVoice(input.voices, input.config.voiceName);
  const info = classifyVoiceSystem(voice);
  const voiceName = voice ? `${voice.name} [${voice.lang}]` : null;

  if (!input.payloadTtsEnabled) {
    return {
      action: "skip",
      reasonCode: "tts-disabled-by-amount",
      reason: "ยอดนี้ไม่ถึงเกณฑ์อ่านเสียง (server ส่ง ttsEnabled=false)",
      primary: "this-window",
      voice,
      voiceName,
      system: info.system,
      systemLabel: info.label,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  if (!input.config.enabled) {
    return {
      action: "skip",
      reasonCode: "window-tts-off",
      reason: "หน้าต่างนี้ปิดการอ่านเสียงไว้ (?tts=0)",
      primary: "this-window",
      voice,
      voiceName,
      system: info.system,
      systemLabel: info.label,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  if (input.emergencyTtsMuted) {
    return {
      action: "skip",
      reasonCode: "emergency-tts-muted",
      reason: "Emergency TTS ปิดอยู่",
      primary: "this-window",
      voice,
      voiceName,
      system: info.system,
      systemLabel: info.label,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  if (input.config.mode !== "local" && input.externalVoiceClients > 0) {
    return {
      action: "skip",
      reasonCode: "external-voice-client",
      reason: `มีตัวอ่านเสียงภายนอก (Edge /overlay/voice) เชื่อมต่อ ${input.externalVoiceClients} หน้าต่าง → ให้ตัวนั้นอ่าน (ใส่ ?tts=local ถ้าต้องการอ่านจากหน้านี้)`,
      primary: "external-voice-client",
      voice,
      voiceName,
      system: info.system,
      systemLabel: info.label,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  if (!input.speechSynthesisAvailable) {
    return {
      action: "skip",
      reasonCode: "no-speech-synthesis",
      reason: "เบราว์เซอร์นี้ไม่รองรับ speechSynthesis",
      primary: "this-window",
      voice,
      voiceName,
      system: info.system,
      systemLabel: info.label,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  const fallbackUsed = !info.isPreferred;

  return {
    action: "speak",
    reasonCode: "speak",
    reason: info.isPreferred
      ? "ใช้เสียงหญิงไทยธรรมชาติ (Edge/online natural)"
      : `ไม่ได้ใช้เสียงหญิงไทยธรรมชาติ (Edge) → ใช้เสียงสำรอง: ${info.label}`,
    primary: "this-window",
    voice,
    voiceName,
    system: info.system,
    systemLabel: info.label,
    fallbackUsed,
    fallbackReason: fallbackUsed ? info.label : null,
  };
}

/**
 * บรรทัดเดียวสำหรับ log/diag: บอกว่าเลือกระบบเสียงไหน อ่านหรือไม่ และ fallback เพราะอะไร
 * (ใช้ทั้งหน้า overlay, /overlay/voice และสคริปต์ทดสอบ)
 */
export function formatTtsDecision(decision: TtsDecision): string {
  const parts = [
    `action=${decision.action}`,
    `primary=${decision.primary}`,
    `system=${decision.system}`,
  ];

  if (decision.action === "speak") {
    parts.push(`voice=${decision.voiceName ?? "browser-default"}`);
    parts.push(`fallback=${decision.fallbackUsed ? "yes" : "no"}`);
  }

  parts.push(`reason=${decision.reason}`);

  return `tts: ${parts.join(" | ")}`;
}

/**
 * บรรทัดสรุปสำหรับแผง ?ttsdiag=1
 *
 * ใช้ rankVoices() (สูตรเดียวกับตอนเลือกเสียงจริง) → คะแนนที่เห็นบนจอ =
 * คะแนนที่ใช้ตัดสินจริง ไม่มีสูตรซ้ำในไฟล์นี้
 */
export function buildVoiceDiag(
  voices: readonly SpeechVoiceInfo[],
  config: TtsConfig,
  picked: SpeechVoiceInfo | null,
  decision?: TtsDecision
): string[] {
  const ranked = rankVoices(voices, config.voiceName);
  const top = ranked[0];
  const runnerUp = ranked[1];
  const info = classifyVoiceSystem(picked);

  const lines = [
    `เสียงทั้งหมด: ${voices.length} · เสียงไทย: ${ranked.length}`,
    `เลือกใช้: ${picked ? `${picked.name} [${picked.lang}]` : "— (ไม่มีเสียงไทยในเครื่องนี้)"}`,
    `voice system: ${info.system} — ${info.label}${info.isPreferred ? " (เป้าหมายหลัก ✅)" : info.isFallback ? " (เสียงสำรอง)" : ""}`,
    `Top score: ${top ? `${top.voice.name} (${top.score})` : "—"}${runnerUp ? ` · Runner-up: ${runnerUp.voice.name} (${runnerUp.score})` : ""}`,
    `rate ${config.rate} · pitch ${config.pitch}${config.voiceName ? ` · บังคับชื่อ "${config.voiceName}"` : ""}`,
    `สถานะอ่านเสียงของหน้าต่างนี้: ${config.enabled ? "เปิด" : "ปิด (?tts=0)"} · โหมดเลือกตัวอ่าน: ${config.mode}`,
  ];

  if (decision) {
    lines.push(`ตัดสินใจล่าสุด: ${formatTtsDecision(decision)}`);
  }

  if (ranked.length === 0) {
    lines.push("⚠ เครื่องนี้ไม่พบเสียงภาษาไทย → จะอ่านด้วยเสียง default (อาจเพี้ยน)");
  } else if (isLikelyMaleVoice(picked)) {
    lines.push(
      "⚠ พบแต่เสียงไทยผู้ชาย → เปิดหน้าต่าง Edge /overlay/voice เพื่อใช้เสียงหญิงธรรมชาติ (ตรวจด้วย scripts\\check-thai-voices.ps1)"
    );
  }

  for (const row of ranked.slice(0, 8)) {
    const tags = [row.voice.lang, row.voice.localService ? "local" : "online", `score ${row.score}`].join(" · ");
    lines.push(`• ${row.voice.name} (${tags})`);
  }

  return lines;
}
