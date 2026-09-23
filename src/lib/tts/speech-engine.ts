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
  isLikelyMaleVoice,
  listThaiVoices,
  pickThaiVoice,
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

export interface TtsConfig {
  /** ชื่อเสียงที่ผู้ใช้บังคับเอง (?ttsvoice=) — null = เลือกอัตโนมัติ */
  voiceName: string | null;
  rate: number;
  pitch: number;
  /** true = แสดงแผงรายชื่อเสียงบนจอ (?ttsdiag=1) */
  diag: boolean;
}

/** อ่านค่าปรับจาก query string ของหน้า Overlay */
export function resolveTtsConfig(search: string): TtsConfig {
  const params = new URLSearchParams(search);
  const rate = Number(params.get("ttsrate"));
  const pitch = Number(params.get("ttspitch"));

  return {
    voiceName: params.get("ttsvoice"),
    rate: Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE ? rate : DEFAULT_TTS_RATE,
    pitch:
      Number.isFinite(pitch) && pitch >= MIN_RATE && pitch <= MAX_RATE
        ? pitch
        : DEFAULT_TTS_PITCH,
    diag: params.get("ttsdiag") === "1",
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

/** บรรทัดสรุปสำหรับแผง ?ttsdiag=1 */
export function buildVoiceDiag(
  voices: readonly SpeechVoiceInfo[],
  config: TtsConfig,
  picked: SpeechVoiceInfo | null
): string[] {
  const thai = listThaiVoices(voices, config.voiceName);

  const lines = [
    `เสียงทั้งหมด: ${voices.length} · เสียงไทย: ${thai.length}`,
    `เลือกใช้: ${picked ? `${picked.name} [${picked.lang}]` : "— (ไม่มีเสียงไทยในเครื่องนี้)"}`,
    `rate ${config.rate} · pitch ${config.pitch}${config.voiceName ? ` · บังคับชื่อ "${config.voiceName}"` : ""}`,
  ];

  if (thai.length === 0) {
    lines.push("⚠ เครื่องนี้ไม่พบเสียงภาษาไทย → จะอ่านด้วยเสียง default (อาจเพี้ยน)");
  } else if (isLikelyMaleVoice(picked)) {
    lines.push("⚠ พบแต่เสียงไทยผู้ชาย → ถ้าต้องการเสียงผู้หญิงให้ติดตั้ง/เลือกเสียงเพิ่ม");
  }

  for (const voice of thai.slice(0, 8)) {
    const tags = [voice.lang, voice.localService ? "local" : "online"].join(" · ");
    lines.push(`• ${voice.name} (${tags})`);
  }

  return lines;
}
