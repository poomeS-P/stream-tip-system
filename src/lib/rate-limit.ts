/**
 * In-memory Sliding Window Rate Limiter
 *
 * เหมาะสำหรับ Single-instance / Development
 * ถ้า Scale ออก Horizontal ให้ใช้ Redis-based rate limiter แทน
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// ทำความสะอาด store ทุก 5 นาทีเพื่อป้องกัน memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    // ลบ entry ที่ไม่มีการใช้งานเกิน 10 นาที
    if (entry.timestamps.length === 0 || now - entry.timestamps[entry.timestamps.length - 1] > 600_000) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (ms)
}

/**
 * @param key     - unique identifier (e.g. IP address)
 * @param limit   - max requests allowed
 * @param windowMs - window size in milliseconds
 */
export function rateLimit(
  key: string,
  limit: number = 10,
  windowMs: number = 60_000
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!store.has(key)) {
    store.set(key, { timestamps: [] });
  }

  const entry = store.get(key)!;

  // ลบ timestamps ที่อยู่นอก window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
    const resetAt = oldest + windowMs;
    return { success: false, limit, remaining: 0, resetAt };
  }

  entry.timestamps.push(now);
  const remaining = limit - entry.timestamps.length;
  const resetAt = entry.timestamps[0] + windowMs;

  return { success: true, limit, remaining, resetAt };
}
