/**
 * ตัวช่วยอ่าน/เขียน cookie ฝั่ง client (ใช้เฉพาะใน Client Component)
 *
 * ทำไมต้องมี:
 *   - ค่า token อาจมีอักขระพิเศษ เช่น "+" "=" "/" (base64)
 *   - การอ่านแบบ `document.cookie.split("=")[1]` จะ "ตัดค่าที่ = ตัวแรก" ทิ้ง
 *     ทำให้ token ที่ลงท้ายด้วย "=" ไม่ครบ → ตรวจสิทธิ์ไม่ผ่าน (401) ทั้งที่รหัสถูก
 *
 * แนวทาง: เขียนด้วย encodeURIComponent เสมอ และอ่านกลับด้วย decodeURIComponent
 * (ค่า cookie เดิมที่เขียนไว้แบบดิบยังอ่านได้ เพราะการ decode จะคืนค่าเดิมเมื่อไม่มี %XX)
 */

export function setClientCookie(name: string, value: string, maxAgeSeconds = 86400): void {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Strict`;
}

export function getClientCookie(name: string): string | null {
    const prefix = `${name}=`;
    const part = document.cookie.split("; ").find((row) => row.startsWith(prefix));
    if (!part) return null;

    // เก็บทุกอย่างหลัง "=" ตัวแรก (รวม "=" ที่เป็นส่วนหนึ่งของค่า เช่น base64 padding)
    const raw = part.slice(prefix.length);
    try {
        return decodeURIComponent(raw);
    } catch {
        // ถ้า decode ไม่ได้ (cookie เก่าที่ไม่ได้ encode) ให้ใช้ค่าดิบ
        return raw;
    }
}

export function clearClientCookie(name: string): void {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Strict`;
}
