import type { AlertEventPayload } from "@/types";

/**
 * In-process SSE Broadcaster
 *
 * จัดการ Server-Sent Events connections สำหรับ OBS Browser Source
 * Single-instance: ถ้าต้องการ Multi-instance ให้ใช้ Redis Pub/Sub แทน
 *
 * "บทบาท" (role) ของ client ใช้ตัดสิน 2 เรื่องของระบบเสียง/คิว:
 *  - `overlay` = หน้าต่าง OBS Browser Source (วาดการ์ด + ACK คิว) ← ตัวที่ทำให้คิวจองได้
 *  - `voice`   = หน้าต่าง /overlay/voice ของ Edge (อ่านเสียงเท่านั้น ไม่ ACK ไม่วาดการ์ด)
 *  - `passive` = หน้าต่างที่แค่อ่าน event (เช่นหน้า Top Donate Podium)
 *                → ไม่ทำคิวถูกจอง และไม่ทำให้หน้าต่างอื่นข้ามการอ่านเสียง
 */

export type SseClientRole = "overlay" | "voice" | "passive";

export interface ClientCounts {
  overlay: number;
  voice: number;
  /** client ที่แค่อ่าน event (ไม่จองคิว ไม่มีผลต่อการเลือกตัวอ่านเสียง) */
  passive: number;
  total: number;
}

interface SseClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  role: SseClientRole;
}

// Map จาก connectionId → client (controller + role)
const clients = new Map<string, SseClient>();

let _idCounter = 0;

function nextId(): string {
  return `sse_${++_idCounter}_${Date.now()}`;
}

/**
 * สร้าง SSE Response Stream ใหม่สำหรับ client ที่เชื่อมต่อ
 * Returns ReadableStream ที่ Next.js ส่งไปให้ OBS
 *
 * role = "overlay" (ค่าเริ่มต้น, ใช้กับ URL เดิม) หรือ "voice" (หน้าต่างอ่านเสียงของ Edge)
 */
export function createSSEStream(
  onClose?: () => void,
  role: SseClientRole = "overlay"
): {
  stream: ReadableStream<Uint8Array>;
  clientId: string;
} {
  const clientId = nextId();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clients.set(clientId, { controller, role });

      // ส่ง comment เพื่อรักษา connection ไว้ (initial ping)
      const initial = ": connected\n\n";
      controller.enqueue(new TextEncoder().encode(initial));
    },
    cancel() {
      clients.delete(clientId);
      onClose?.();
    },
  });

  return { stream, clientId };
}

/**
 * ส่งข้อมูลดิบไปทุก client ที่เชื่อมต่ออยู่ · คืนจำนวน client ที่ตายและถูกลบออกไป
 * (เป็นจุดเดียวที่ enqueue ลง controller → จัดการ dead client ที่เดียว)
 */
function sendRaw(data: string): number {
  const encoded = new TextEncoder().encode(data);
  const deadClients: string[] = [];

  for (const [id, client] of clients.entries()) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      // client ตัดการเชื่อมต่อ
      deadClients.push(id);
    }
  }

  for (const id of deadClients) {
    clients.delete(id);
  }

  return deadClients.length;
}

/**
 * ส่ง Alert event ไปยังทุก client ที่เชื่อมต่ออยู่
 * (overlay วาดการ์ด · voice client อ่านเสียง)
 */
export function broadcastAlert(payload: AlertEventPayload): void {
  sendRaw(`event: alert\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * ส่ง emergency event เพื่อสั่งปิด Alert/TTS ทันที
 */
export function broadcastEmergency(payload: { alertMuted: boolean; ttsMuted: boolean }): void {
  sendRaw(`event: emergency\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * ส่ง heartbeat ping เพื่อรักษา connection ไม่ให้ OBS timeout
 * เรียกจาก setInterval ใน SSE route handler
 * คืนจำนวน client ที่ตายและถูกลบออก (route ใช้ตัดสินใจว่า จะ broadcast presence ใหม่ไหม)
 */
export function sendHeartbeats(): number {
  return sendRaw(": heartbeat\n\n");
}

/** จำนวน client แยกตามบทบาท */
export function getClientCounts(): ClientCounts {
  let overlay = 0;
  let voice = 0;
  let passive = 0;

  for (const client of clients.values()) {
    if (client.role === "voice") voice += 1;
    else if (client.role === "passive") passive += 1;
    else overlay += 1;
  }

  return { overlay, voice, passive, total: overlay + voice + passive };
}

/**
 * แจ้งจำนวน client แยกบทบาทให้ทุกหน้าต่างรู้
 *
 * หน้าต่าง overlay ใช้ค่านี้ตัดสินว่าจะอ่านเสียงเองหรือปล่อยให้ Edge (`/overlay/voice`) อ่าน
 * → "Edge เป็นตัวอ่านหลัก" ทำงานได้เองโดยไม่ต้องตั้ง `?tts=0` ด้วยมือ
 */
export function broadcastPresence(): ClientCounts {
  const counts = getClientCounts();
  sendRaw(`event: presence\ndata: ${JSON.stringify(counts)}\n\n`);
  return counts;
}

/**
 * นับ client ที่เชื่อมต่ออยู่ · ระบุ role เพื่อนับเฉพาะบทบาทนั้น
 * (ไม่ระบุ = นับทั้งหมด — คงพฤติกรรมเดิมไว้)
 */
export function getConnectedClientCount(role?: SseClientRole): number {
  if (!role) return clients.size;

  const counts = getClientCounts();
  if (role === "voice") return counts.voice;
  if (role === "passive") return counts.passive;
  return counts.overlay;
}
