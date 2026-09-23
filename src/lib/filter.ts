/**
 * Content Filter & XSS Sanitizer
 *
 * - ตรวจสอบคำจาก Blocklist (case-insensitive)
 * - ทำ XSS sanitization โดยลบ HTML tags และ JS event attributes
 * - จำกัดความยาวข้อความตาม System Settings
 */

export interface FilterResult {
  cleanText: string;
  hasFilteredWord: boolean;
  shouldBlock: boolean; // true = ต้องซ่อนข้อความทั้งหมด
}

/**
 * ลบ HTML tags และ Event handlers ออกจาก string
 * ป้องกัน XSS ใน OBS Browser Source ซึ่งเป็น Chromium
 */
export function sanitizeHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "") // ลบ HTML tags ทั้งหมด
    .replace(/on\w+\s*=/gi, "") // ลบ event handlers เช่น onclick=, onerror=
    .replace(/javascript\s*:/gi, "") // ลบ javascript: URL scheme
    .replace(/data\s*:/gi, "") // ลบ data: URL scheme
    .trim();
}

/**
 * กรองข้อความตาม blocklist
 * @param text         - ข้อความต้นฉบับ
 * @param bannedWords  - รายการคำต้องห้ามจาก SystemSetting
 * @param blockEntire  - true = ซ่อนทั้งประโยค, false = ทำเป็นดอกจัน ***
 * @param maxLength    - ความยาวสูงสุดที่อนุญาต
 */
export function filterContent(
  text: string,
  bannedWords: string[],
  blockEntire: boolean = false,
  maxLength: number = 150
): FilterResult {
  if (!text || text.trim().length === 0) {
    return { cleanText: "", hasFilteredWord: false, shouldBlock: false };
  }

  // ทำ XSS sanitize ก่อน
  let sanitized = sanitizeHtml(text);

  // จำกัดความยาว
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + "…";
  }

  if (bannedWords.length === 0) {
    return { cleanText: sanitized, hasFilteredWord: false, shouldBlock: false };
  }

  // ตรวจหาคำหยาบ (case-insensitive, word boundary aware)
  let hasFilteredWord = false;
  let cleanText = sanitized;

  for (const word of bannedWords) {
    if (!word || word.trim().length === 0) continue;

    // Escape special regex chars ในคำหยาบ
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");

    if (regex.test(cleanText)) {
      hasFilteredWord = true;

      if (blockEntire) {
        // ซ่อนทั้งหมด
        return { cleanText: "[ข้อความถูกซ่อน]", hasFilteredWord: true, shouldBlock: true };
      }

      // ทำเป็นดอกจัน
      cleanText = cleanText.replace(regex, (match) => "★".repeat(match.length));
    }
  }

  return { cleanText, hasFilteredWord, shouldBlock: false };
}

/**
 * ตรวจสอบชื่อผู้บริจาค (sanitize เท่านั้น ไม่ต้องผ่าน blocklist)
 */
export function sanitizeName(name: string, maxLength: number = 50): string {
  return sanitizeHtml(name).substring(0, maxLength).trim();
}
