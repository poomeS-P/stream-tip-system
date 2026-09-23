/**
 * เตรียมข้อความให้ "อ่านออกเสียง" ได้เป็นธรรมชาติ (ภาษาไทย)
 *
 * ปัญหาที่แก้:
 * 1) ตัวเลขที่มี comma/จุดทศนิยม (เช่น "1,000" หรือ "25.50") ทำให้ TTS อ่านเพี้ยน
 *    → แปลงเป็นคำอ่านไทยล้วน ("หนึ่งพันบาท" / "ยี่สิบห้าบาทห้าสิบสตางค์")
 * 2) ข้อความจากผู้ชมมี emoji / ★ (เครื่องหมายแทนคำที่ถูกกรอง) / URL / @username
 *    → ตัดออกก่อนอ่าน เพื่อไม่ให้อ่าน "syntax" ของระบบออกมา
 * 3) ไม่มีจังหวะเว้นวรรคระหว่างชื่อ-ยอด-ข้อความ → ใส่ ", " ให้ TTS หยุดหายใจสั้น ๆ ตามธรรมชาติ
 *
 * เป็น pure function ทั้งหมด → ทดสอบได้ด้วย `npx tsx scripts/tts-preview.ts`
 */

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_POSITIONS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** อ่านจำนวนเต็มเป็นคำไทย (รองรับถึงหลักล้านขึ้นไป) */
function readThaiInteger(value: number): string {
  const absolute = Math.floor(Math.abs(value));
  if (absolute === 0) return THAI_DIGITS[0];

  // แยกทีละ 6 หลัก จากขวาไปซ้าย แล้วต่อท้ายด้วย "ล้าน"
  const groups: number[] = [];
  let remaining = absolute;
  while (remaining > 0) {
    groups.push(remaining % 1_000_000);
    remaining = Math.floor(remaining / 1_000_000);
  }

  const readGroup = (group: number): string => {
    let result = "";
    let position = 0;
    let rest = group;

    while (rest > 0) {
      const digit = rest % 10;

      if (digit !== 0) {
        let word = THAI_DIGITS[digit];

        if (position === 1 && digit === 1) word = ""; // 10 → "สิบ" ไม่ใช่ "หนึ่งสิบ"
        if (position === 1 && digit === 2) word = "ยี่"; // 20 → "ยี่สิบ"
        if (position === 0 && digit === 1 && group > 10) word = "เอ็ด"; // 21 → "ยี่สิบเอ็ด"

        result = word + THAI_POSITIONS[position] + result;
      }

      position += 1;
      rest = Math.floor(rest / 10);
    }

    return result;
  };

  let text = "";
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index] === 0) continue;
    text += readGroup(groups[index]) + (index > 0 ? "ล้าน" : "");
  }

  return text || THAI_DIGITS[0];
}

/**
 * แปลงจำนวนเงิน (บาท) เป็นคำอ่านไทย
 * - 300      → "สามร้อยบาท"
 * - 1000     → "หนึ่งพันบาท"
 * - 25.5     → "ยี่สิบห้าบาทห้าสิบสตางค์"
 * - 0.5      → "ห้าสิบสตางค์"
 */
export function thaiBahtToWords(amount: number): string {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const totalSatang = Math.round(safeAmount * 100);
  const baht = Math.floor(totalSatang / 100);
  const satang = totalSatang % 100;

  if (satang === 0) return `${readThaiInteger(baht)}บาท`;
  if (baht === 0) return `${readThaiInteger(satang)}สตางค์`;

  return `${readThaiInteger(baht)}บาท${readThaiInteger(satang)}สตางค์`;
}

/** อักขระที่ "ห้ามอ่านออกเสียง" (emoji/สัญลักษณ์/เครื่องหมายที่ระบบใช้แทนคำหยาบ) */
function isSpeechNoise(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;

  if (code === 0x2605 || code === 0x2606) return true; // ★ ☆ = คำที่ถูกกรอง
  if (code === 0xfe0f || code === 0x200d) return true; // variation selector / ZWJ
  if (code >= 0x2190 && code <= 0x21ff) return true; // ลูกศร
  if (code >= 0x1f000 && code <= 0x1faff) return true; // emoji / pictographs
  if (code >= 0x1f1e6 && code <= 0x1f1ff) return true; // ธง
  if (code >= 0x2600 && code <= 0x27bf) return true; // สัญลักษณ์ทั่วไป (✔ ✨ ฯลฯ)
  if (code >= 0x2b00 && code <= 0x2bff) return true;
  if (code >= 0x3000 && code <= 0x303f) return code !== 0x3000; // วรรคตอน CJK
  if (code < 0x20) return true; // control characters

  return false;
}

/** ตัวอักษรที่ยอมให้อ่าน: ไทย · อังกฤษ · ตัวเลข · ช่องว่าง · วรรคตอนไทย */
function isSpeakable(char: string): boolean {
  if (/\s/.test(char)) return true;
  if (/[0-9A-Za-z\u0E00-\u0E7F]/.test(char)) return true; // ไทย (รวม ๆ ฯ) + อังกฤษ/ตัวเลข
  if (char === "," || char === ".") return true; // เก็บไว้เป็นจังหวะหยุดหายใจ

  return false;
}

/**
 * ทำข้อความให้พร้อมอ่าน
 * - ตัด URL / @username / #hashtag / emoji / ★ / สัญลักษณ์ระบบ
 * - ยุบช่องว่างซ้ำ และตัดให้ไม่ยาวเกิน maxChars (กันอ่านยาวเกินเวลาที่การ์ดค้างบนจอ)
 */
export function sanitizeForSpeech(text: string, maxChars = 200): string {
  if (!text) return "";

  let working = text.normalize("NFC");

  // URL และ mention มักอ่านเป็นตัวอักษรเรียงกันแบบไร้ความหมาย → ตัดทิ้ง
  working = working.replace(/https?:\/\/\S+/gi, " ");
  working = working.replace(/www\.\S+/gi, " ");
  working = working.replace(/@[A-Za-z0-9_.-]+/g, " ");
  working = working.replace(/#[A-Za-z0-9_]+/g, " ");

  let result = "";
  for (const char of Array.from(working)) {
    if (isSpeechNoise(char)) {
      result += " ";
      continue;
    }

    result += isSpeakable(char) ? char : " ";
  }

  const decimalDot = "\u0001";

  // ป้องกัน "." ที่อยู่ระหว่างตัวเลข (ทศนิยม เช่น 25.50) ไม่ให้ถูกมองเป็นจุดจบประโยค
  result = result.replace(/(\d)\.(\d)/g, `$1${decimalDot}$2`);

  // ตัด comma ที่ใช้คั่นหลักพันในตัวเลข (1,000 → 1000) เพื่อไม่ให้ TTS หยุดอ่านกลางตัวเลข
  while (/\d,\d/.test(result)) {
    result = result.replace(/(\d),(\d)/g, "$1$2");
  }

  result = result
    .replace(/\s*,\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\.\s*/g, " ")
    .replace(/,\s*(?=,)/g, ",")
    .replace(/(^[\s,]+)|([\s,]+$)/g, "")
    .trim()
    .split(decimalDot)
    .join(".");

  if (result.length <= maxChars) return result;

  // ตัดที่ขอบคำ (ไม่ตัดกลางคำ) เพื่อไม่ให้ได้ยินคำขาด
  const cut = result.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");

  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface SpeechTextInput {
  donorName: string;
  amount: number;
  message?: string | null;
}

/**
 * สร้างข้อความที่ใช้ "อ่านออกเสียง" เพียงหนึ่งชุด
 * รูปแบบ: "{ชื่อ} สนับสนุนจำนวน {ยอดเป็นคำไทย}, {ข้อความ}"
 * (เครื่องหมายจุลภาคทำให้ TTS หยุดหายใจสั้น ๆ ระหว่างช่วงข้อความ)
 */
export function buildSpeechText(input: SpeechTextInput): string {
  const name = sanitizeForSpeech(input.donorName, 60) || "ผู้สนับสนุน";
  const head = `${name} สนับสนุนจำนวน ${thaiBahtToWords(input.amount)}`;
  const message = input.message ? sanitizeForSpeech(input.message, 200) : "";

  return message ? `${head}, ${message}` : head;
}
