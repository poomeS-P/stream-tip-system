import type { AlertEventPayload } from "@/types";

/**
 * In-process SSE Broadcaster
 *
 * จัดการ Server-Sent Events connections สำหรับ OBS Browser Source
 * Single-instance: ถ้าต้องการ Multi-instance ให้ใช้ Redis Pub/Sub แทน
 */

// Map จาก connectionId → ReadableStream controller
const clients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

let _idCounter = 0;

function nextId(): string {
  return `sse_${++_idCounter}_${Date.now()}`;
}

/**
 * สร้าง SSE Response Stream ใหม่สำหรับ client ที่เชื่อมต่อ
 * Returns ReadableStream ที่ Next.js ส่งไปให้ OBS
 */
export function createSSEStream(onClose?: () => void): {
  stream: ReadableStream<Uint8Array>;
  clientId: string;
} {
  const clientId = nextId();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clients.set(clientId, controller);

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
 * ส่ง Alert event ไปยังทุก OBS client ที่เชื่อมต่ออยู่
 */
export function broadcastAlert(payload: AlertEventPayload): void {
  const data = `event: alert\ndata: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(data);

  const deadClients: string[] = [];

  for (const [id, controller] of clients.entries()) {
    try {
      controller.enqueue(encoded);
    } catch {
      // client ตัดการเชื่อมต่อ
      deadClients.push(id);
    }
  }

  for (const id of deadClients) {
    clients.delete(id);
  }
}

/**
 * ส่ง emergency event เพื่อสั่งปิด Alert/TTS ทันที
 */
export function broadcastEmergency(payload: { alertMuted: boolean; ttsMuted: boolean }): void {
  const data = `event: emergency\ndata: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(data);

  const deadClients: string[] = [];

  for (const [id, controller] of clients.entries()) {
    try {
      controller.enqueue(encoded);
    } catch {
      deadClients.push(id);
    }
  }

  for (const id of deadClients) {
    clients.delete(id);
  }
}

/**
 * ส่ง heartbeat ping เพื่อรักษา connection ไม่ให้ OBS timeout
 * เรียกจาก setInterval ใน SSE route handler
 */
export function sendHeartbeats(): void {
  const ping = ": heartbeat\n\n";
  const encoded = new TextEncoder().encode(ping);

  const deadClients: string[] = [];

  for (const [id, controller] of clients.entries()) {
    try {
      controller.enqueue(encoded);
    } catch {
      deadClients.push(id);
    }
  }

  for (const id of deadClients) {
    clients.delete(id);
  }
}

export function getConnectedClientCount(): number {
  return clients.size;
}
