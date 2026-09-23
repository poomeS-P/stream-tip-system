import type { JsonObject, JsonValue } from "@/types";

/**
 * JSON Normalizer
 *
 * แปลงค่าใด ๆ (เช่น Stripe.Event) ให้เป็น Plain JSON ที่ปลอดภัยต่อการ
 * บันทึกลง Prisma Json field โดยไม่ต้องใช้ `as any`
 *
 * เหตุผลที่ต้องมี Helper นี้:
 * - Prisma กำหนดให้ Json field รับได้เฉพาะ InputJsonValue (string | number | boolean |
 *   object | array) เท่านั้น — ห้าม undefined / Date / function / bigint
 * - Stripe SDK ส่ง object ที่มี Date (เช่น created) และ property ที่เป็น undefined ปนมาด้วย
 *   จึงต้อง Normalize ก่อนเก็บลง DB
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * แปลงค่าแบบ Recursive ให้เป็น JsonValue
 * - Date → ISO string
 * - undefined / function / symbol / bigint / NaN / Infinity → null (หรือถูกข้ามใน object)
 * - Object → Plain object ใหม่ (ไม่ถือ reference ของ SDK object)
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    // NaN / Infinity ไม่ใช่ค่าที่ JSON รองรับ
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));

  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      // ข้าม key ที่เป็น undefined เพื่อรักษาความหมายเดิมของ payload
      if (entry === undefined) continue;
      result[key] = toJsonValue(entry);
    }
    return result;
  }

  // function / symbol / bigint
  return null;
}

/**
 * แปลงค่าให้เป็น JsonObject (ระดับบนสุดต้องเป็น object)
 * ถ้าค่าที่ส่งมาไม่ใช่ object จะถูกห่อเป็น { value: ... } เพื่อให้ชนิดข้อมูลถูกต้องเสมอ
 */
export function toJsonObject(value: unknown): JsonObject {
  const converted = toJsonValue(value);

  if (converted !== null && typeof converted === "object" && !Array.isArray(converted)) {
    return converted;
  }

  return { value: converted };
}
