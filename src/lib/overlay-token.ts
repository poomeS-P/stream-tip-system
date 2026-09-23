/**
 * ตัวช่วยจัดการ Overlay Token ที่รับมาทาง query string
 *
 * ปัญหาที่แก้: ถ้า OVERLAY_TOKEN มีอักขระ "+" แล้วผู้ใช้ paste URL ดิบ ๆ
 * ใน query string ตัว "+" จะถูก decode เป็น "เว้นวรรค" (URLSearchParams)
 * ทำให้เทียบ token ไม่ตรง → หน้า /overlay เด้งกลับหน้าหลัก (ส่งทิป) และ SSE ได้ 401
 *
 * normalizeOverlayToken() คืนค่าให้ตรงกับ token จริงเสมอ โดย "ไม่ลดความปลอดภัย"
 * เพราะเป็นการยอมรับ "การ encode ที่ต่างกันของ token เดียวกัน" ไม่ได้ยอมรับ token อื่น
 */
export function normalizeOverlayToken(value: string): string {
  return value.replace(/ /g, "+");
}

/** เทียบ token ที่ได้รับมากับค่าจริง (รองรับทั้งแบบดิบและแบบถูก decode เป็นเว้นวรรค) */
export function isOverlayToken(value: string | null, expected: string | undefined): boolean {
  if (value === null || !expected) return false;
  return value === expected || normalizeOverlayToken(value) === expected;
}
