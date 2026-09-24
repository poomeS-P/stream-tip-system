/**
 * การเลือก "เสียงอ่าน" (Text-to-Speech) ของหน้า Overlay
 *
 * ทำไมต้องมีโมดูลนี้:
 * - ตอนแรกโค้ดไม่เคยกำหนด `utter.voice` เลย → เบราว์เซอร์ใช้เสียง default ของระบบ
 *   ซึ่งมักเป็นเสียงอังกฤษ (เช่น Microsoft David/Zira) จึงอ่านภาษาไทยเพี้ยน
 * - Web Speech API ไม่ได้เลือกเสียงตาม `utter.lang` ให้เสมอไป ต้องเลือกเองจากรายการ getVoices()
 *
 * ลำดับความสำคัญ (ตามที่เจ้าของช่องต้องการ):
 *   1) ภาษาไทยถูกต้อง (lang ขึ้นต้นด้วย th)
 *   2) เสียงผู้หญิง (เปรมวดี / Premwadee / Kanya / Female)
 *   3) เสียงคุณภาพสูง อ่านธรรมชาติ (Natural · Neural · Online)
 *   4) เสียงที่ติดตั้งในเครื่อง (localService) เพราะทำงานได้แม้ไม่มีอินเทอร์เน็ต
 *
 * เป็น pure function ทั้งหมด จึงทดสอบได้ด้วย `npx tsx scripts/tts-preview.ts`
 * (ไม่ต้องเปิดเบราว์เซอร์/OBS)
 */

export interface SpeechVoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/**
 * คำในชื่อเสียงที่บ่งชี้ว่าเป็น "เสียงผู้หญิง"
 *
 * หมายเหตุสำคัญ: ชื่อเสียง "ไม่จำเป็น" ต้องมีคำเหล่านี้เพื่อให้ชนะการเลือก
 * เพราะเสียงไทยทุกตัวได้คะแนนฐานเท่ากัน (1,000) การหักคะแนนเสียงผู้ชาย (−400)
 * ทำให้เสียงหญิงชนะอยู่แล้วเมื่อเครื่องมีเสียงให้เลือก — hint เหล่านี้เป็นแค่ตัวช่วย
 * จัดลำดับให้ชัดขึ้น และทำให้ `?ttsvoice=` (จับแบบ substring) ใช้งานได้ตรงขึ้น
 */
const FEMALE_HINTS = [
  "premwadee",
  "เปรมวดี",
  "kanya",
  "female",
  "หญิง",
  "woman",
  "chompoo",
  "ชมพู",
  "ploy",
  "พลอย",
  "nina",
  "หญิงไทย",
  "thai female",
];

/** คำในชื่อเสียงที่บ่งชี้ว่าเป็น "เสียงผู้ชาย" (ใช้หักคะแนน ไม่ได้ห้ามใช้ — ถ้าเครื่องมีแค่นี้ก็ต้องใช้) */
const MALE_HINTS = ["pattara", "ภัทร", "niwat", "นิวัฒน์", "male", "david", "mark"];

/** คำในชื่อเสียงที่บ่งชี้ว่าเป็นเสียงคุณภาพสูง/อ่านลื่น */
const NATURAL_HINTS = ["natural", "neural", "online", "premium", "enhanced", "google"];

/** แปลงรายชื่อเสียงจากเบราว์เซอร์เป็นโครงสร้างที่ระบบใช้ (กัน field หาย) */
export function toVoiceInfoList(voices: readonly SpeechSynthesisVoice[]): SpeechVoiceInfo[] {
  return voices.map((voice) => ({
    name: String(voice.name ?? ""),
    lang: String(voice.lang ?? ""),
    localService: Boolean(voice.localService),
    default: Boolean(voice.default),
  }));
}

/** true = เสียงนี้เป็นภาษาไทย */
export function isThaiVoice(voice: SpeechVoiceInfo): boolean {
  return voice.lang.toLowerCase().startsWith("th");
}

/**
 * คะแนนความเหมาะสม — ยิ่งมากยิ่งเหมาะ
 * คืน null = "ใช้ไม่ได้" (ไม่ใช่เสียงไทยและไม่ได้ถูกบังคับให้ใช้ผ่าน ?ttsvoice=)
 */
export function scoreVoice(voice: SpeechVoiceInfo, preferName?: string | null): number | null {
  const name = voice.name.toLowerCase();

  // ผู้ใช้ระบุชื่อเสียงเอง (?ttsvoice=) → ชนะทุกเกณฑ์ แม้จะไม่ใช่เสียงไทย
  if (preferName) {
    const target = preferName.trim().toLowerCase();
    if (target.length > 0 && name.includes(target)) return 10_000;
  }

  if (!isThaiVoice(voice)) return null;

  let score = 1_000;
  if (voice.lang.toLowerCase() === "th-th") score += 50;
  if (FEMALE_HINTS.some((hint) => name.includes(hint))) score += 300;
  if (MALE_HINTS.some((hint) => name.includes(hint))) score -= 400;
  if (NATURAL_HINTS.some((hint) => name.includes(hint))) score += 120;
  if (voice.localService) score += 30;
  if (voice.default) score += 5;

  return score;
}

/** เลือกเสียงไทยที่เหมาะที่สุด — คืน null = เครื่องนี้ไม่มีเสียงไทยเลย */
export function pickThaiVoice(
  voices: readonly SpeechVoiceInfo[],
  preferName?: string | null
): SpeechVoiceInfo | null {
  let best: SpeechVoiceInfo | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const voice of voices) {
    const score = scoreVoice(voice, preferName);
    if (score === null) continue;

    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }

  return best;
}

/**
 * คะแนนของเสียงทุกตัวที่ "ใช้ได้" เรียงจากมากไปน้อย พร้อมคะแนนของแต่ละตัว
 *
 * เป็นตัวเดียวที่ใช้ทั้งการเลือกเสียงจริง (pickThaiVoice) และแผงวินิจฉัย (?ttsdiag=1)
 * → ไม่มีสูตรให้คะแนนซ้ำสองที่ในระบบ
 */
export function rankVoices(
  voices: readonly SpeechVoiceInfo[],
  preferName?: string | null
): { voice: SpeechVoiceInfo; score: number }[] {
  return voices
    .map((voice) => ({ voice, score: scoreVoice(voice, preferName) }))
    .filter((row): row is { voice: SpeechVoiceInfo; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score);
}

/** รายชื่อเสียงไทยทั้งหมด เรียงจากคะแนนมากไปน้อย — ใช้กับ `?ttsdiag=1` */
export function listThaiVoices(
  voices: readonly SpeechVoiceInfo[],
  preferName?: string | null
): SpeechVoiceInfo[] {
  return rankVoices(voices, preferName).map((row) => row.voice);
}

/** true = เสียงที่เลือกน่าจะเป็นเสียงผู้ชาย (ใช้เตือนใน diag ว่าเครื่องนี้ยังไม่มีเสียงผู้หญิงไทย) */
export function isLikelyMaleVoice(voice: SpeechVoiceInfo | null): boolean {
  if (!voice) return false;

  const name = voice.name.toLowerCase();
  return (
    MALE_HINTS.some((hint) => name.includes(hint)) &&
    !FEMALE_HINTS.some((hint) => name.includes(hint))
  );
}

/** true = เสียงนี้เป็นเสียงผู้หญิง (มีคำใบ้หญิง และไม่มีคำใบ้ชาย) */
export function isLikelyFemaleVoice(voice: SpeechVoiceInfo | null): boolean {
  if (!voice) return false;

  const name = voice.name.toLowerCase();
  return (
    FEMALE_HINTS.some((hint) => name.includes(hint)) &&
    !MALE_HINTS.some((hint) => name.includes(hint))
  );
}

/** true = เสียงนี้เป็นเสียงคุณภาพสูง/อ่านธรรมชาติ (Natural · Neural · Online · Google ฯลฯ) */
export function isNaturalVoice(voice: SpeechVoiceInfo | null): boolean {
  if (!voice) return false;

  const name = voice.name.toLowerCase();
  return NATURAL_HINTS.some((hint) => name.includes(hint));
}
