/**
 * ระยะเวลาที่ Alert ค้างบนจอ (วินาที)
 *
 * ทำไมต้องคำนวณ: ค่าที่ตั้งใน Admin (`SystemSetting.alertDurationSec`) คือ "เวลาขั้นต่ำ"
 * ถ้าข้อความยาว ผู้ชม/คนอ่านต้องใช้เวลามากขึ้น -> ขยับเวลาตามความยาวอัตโนมัติ
 * (แต่ไม่เกินเพดาน เพื่อไม่ให้ Alert ค้างข้ามรายการ)
 *
 * กติกา: durationSeconds = clamp( max(ค่าที่ตั้ง, เวลาที่ใช้กวาดสายตาประมาณ), ขั้นต่ำ, เพดาน )
 * - ชื่อ + ยอด + ข้อความ (ข้อความเดียวกันกับที่ TTS อ่าน) -> ยิ่งยาวยิ่งค้างนานขึ้น
 * - ปรับได้ผ่าน env (ไม่ต้องแก้โค้ด):
 *     ALERT_READ_MS_PER_CHAR  = ms ต่อ 1 ตัวอักษร (ค่าเริ่มต้น 110)
 *     ALERT_READ_BASE_MS      = เวลาตั้งต้นก่อนเริ่มนับตัวอักษร (2500 ms)
 *     ALERT_MAX_DURATION_SEC  = เพดานเวลาที่ค้าง (20 วินาที)
 */

const DEFAULT_MS_PER_CHAR = 110;
const DEFAULT_BASE_MS = 2500;
const DEFAULT_MAX_SECONDS = 20;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  return Math.min(max, Math.max(min, value));
}

export function readDurationTuning(): { msPerChar: number; baseMs: number; maxSeconds: number } {
  return {
    msPerChar: envNumber("ALERT_READ_MS_PER_CHAR", DEFAULT_MS_PER_CHAR, 0, 2000),
    baseMs: envNumber("ALERT_READ_BASE_MS", DEFAULT_BASE_MS, 0, 60_000),
    maxSeconds: envNumber("ALERT_MAX_DURATION_SEC", DEFAULT_MAX_SECONDS, 1, 600),
  };
}

/**
 * ข้อความที่ผู้ชมได้ยิน (TTS) = ชื่อ + ยอด + ข้อความ
 * ใช้เป็นตัววัด "ความยาวที่ต้องอ่าน" — ที่เดียวกับ buildTTSText() ฝั่ง Overlay
 */
export function alertReadingText(input: { donorName: string; amount: number; message: string }): string {
  const amount = input.amount.toLocaleString("th-TH");
  const message = input.message?.trim();

  return message ? `${input.donorName} บริจาค ${amount} บาท ${message}` : `${input.donorName} บริจาค ${amount} บาท`;
}

export interface AlertDurationInput {
  donorName: string;
  amount: number;
  message: string;
  /** ค่าที่ตั้งใน Admin (SystemSetting.alertDurationSec) = เวลาขั้นต่ำ */
  baseSeconds: number;
}

/** คำนวณระยะเวลาแสดง (วินาที) จากความยาวข้อความ + เวลาขั้นต่ำที่ตั้งไว้ */
export function computeAlertDurationSeconds(input: AlertDurationInput): number {
  const { msPerChar, baseMs, maxSeconds } = readDurationTuning();

  const base = Math.max(1, Math.round(input.baseSeconds) || 1);
  const chars = alertReadingText(input).length;
  const readingSeconds = (baseMs + chars * msPerChar) / 1000;

  const ceiling = Math.max(base, maxSeconds);

  return Math.min(ceiling, Math.max(base, Math.ceil(readingSeconds)));
}
