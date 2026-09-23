/**
 * smoke.ts — เอนจิน "ควันรอบกรอบข้อความ" สำหรับ Overlay
 *
 * พอร์ตแนวคิดมาจาก poomes-stream-system/views/alert.html (การ์ด Goal / Latest Follower):
 *  - ควันอยู่เฉพาะ "แถบรอบกรอบ" (band) → กลางกรอบสะอาด ข้อความอ่านง่ายเสมอ
 *  - 3 ระนาบ (หลัง/กลาง/หน้า) ให้ดูมีมิติ + ก้อนลอยขึ้นช้า ๆ
 *  - sprite ถูกอบล่วงหน้า (ก้อนเมฆจากหลาย lobe + gradient) แล้ววาดซ้ำด้วย drawImage → เบาพอสำหรับ OBS
 *  - ช่วง "enter" = กระเพื่อมเบา ๆ ตอนมีแจ้งเตือนใหม่
 *  - ปรับค่าได้ผ่าน URL query (แบบเดียวกับระบบเก่า):
 *    ?smokesize=1.2&smokecount=1.4&smokeop=0.9&smokespeed=1&smokeband=52&smoketone=light
 */

export interface SmokeOptions {
    /** ความหนาแถบควันรอบกรอบ (px) */
    band: number;
    /** ตัวคูณขนาดก้อนควัน */
    size: number;
    /** ตัวคูณจำนวนก้อนควัน */
    count: number;
    /** ความทึบรวม (0-1) */
    opacity: number;
    /** ตัวคูณความเร็วการลอย */
    speed: number;
    /** โทนสีควัน — light (ค่าเริ่มต้น) หรือ dark (สำหรับฉากสว่าง) */
    tone: "light" | "dark";
}

export const SMOKE_DEFAULTS: SmokeOptions = {
    band: 52,
    size: 1,
    count: 1,
    opacity: 0.9,
    speed: 1,
    tone: "light",
};

export function readSmokeOptions(search: string): SmokeOptions {
    const params = new URLSearchParams(search);
    const num = (key: string, fallback: number, min: number, max: number): number => {
        const raw = params.get(key);
        if (raw === null) return fallback;
        const value = Number(raw);
        if (!Number.isFinite(value)) return fallback;
        return Math.min(max, Math.max(min, value));
    };

    return {
        band: num("smokeband", SMOKE_DEFAULTS.band, 0, 200),
        size: num("smokesize", SMOKE_DEFAULTS.size, 0.3, 3),
        count: num("smokecount", SMOKE_DEFAULTS.count, 0.2, 3),
        opacity: num("smokeop", SMOKE_DEFAULTS.opacity, 0, 1),
        speed: num("smokespeed", SMOKE_DEFAULTS.speed, 0, 3),
        tone: params.get("smoketone") === "dark" ? "dark" : "light",
    };
}

/** deterministic PRNG — ทำให้ตำแหน่ง/รูปทรงควันซ้ำได้ (เทียบภาพก่อน/หลังได้ตรง) */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Tone {
    lit: [number, number, number];
    body: [number, number, number];
    shade: [number, number, number];
}

const TONES: Record<SmokeOptions["tone"], Tone> = {
    // โทนเดียวกับระบบเก่า (ควันสว่างอมฟ้า)
    light: {
        lit: [242, 246, 252],
        body: [216, 223, 233],
        shade: [174, 182, 196],
    },
    // โทนเข้ม สำหรับฉากพื้นสว่าง
    dark: {
        lit: [96, 102, 114],
        body: [64, 70, 82],
        shade: [34, 38, 48],
    },
};

const SPRITE_SIZE = 128; // px — ขนาด sprite ก้อนควัน (อบครั้งเดียว ใช้ซ้ำ)
const SPRITE_VARIANTS = 6;
/** อบ sprite ก้อนควัน (ใช้ lobe หลายก้อนรวมกัน + เงา/ไฮไลต์แบบ source-atop) */
function bakeSprite(rand: () => number, tone: Tone): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;

    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    const cx = SPRITE_SIZE / 2;
    const cy = SPRITE_SIZE / 2;
    const lobes = 4 + Math.floor(rand() * 3); // 4-6 ก้อน
    const ring = SPRITE_SIZE * (0.16 + rand() * 0.06);
    const rgba = (color: [number, number, number], alpha: number): string =>
        `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;

    const drawLobe = (x: number, y: number, rx: number, ry: number, color: [number, number, number], alpha: number): void => {
        const radius = Math.max(rx, ry);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, rgba(color, alpha));
        gradient.addColorStop(0.45, rgba(color, alpha * 0.72));
        gradient.addColorStop(1, rgba(color, 0));
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(rx / radius, ry / radius);
        ctx.translate(-x, -y);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };

    // 1) ตัวก้อนหลัก
    for (let i = 0; i < lobes; i++) {
        const angle = (i / lobes) * Math.PI * 2 + rand() * 0.8;
        const distance = ring * (0.75 + rand() * 0.5);
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance * 0.82;
        const radius = SPRITE_SIZE * (0.15 + rand() * 0.07);
        drawLobe(x, y, radius * 1.05, radius * (0.88 + rand() * 0.2), tone.body, 0.5 + rand() * 0.12);
    }
    drawLobe(cx, cy, SPRITE_SIZE * 0.24, SPRITE_SIZE * 0.21, tone.body, 0.55);

    // 2) ไฮไลต์ด้านบน + เงาด้านล่าง (วาดทับเฉพาะพื้นที่ที่มีอยู่แล้ว)
    ctx.globalCompositeOperation = "source-atop";
    for (let i = 0; i < lobes; i++) {
        const angle = (i / lobes) * Math.PI * 2 + rand() * 0.8;
        const x = cx + Math.cos(angle) * ring * 0.9;
        const y = cy + Math.sin(angle) * ring * 0.7 - SPRITE_SIZE * 0.05;
        drawLobe(x, y, SPRITE_SIZE * 0.16, SPRITE_SIZE * 0.13, tone.lit, 0.3);
    }
    for (let i = 0; i < Math.max(2, lobes - 2); i++) {
        const x = cx + (rand() - 0.5) * ring * 1.3;
        const y = cy + ring * 0.8 + (rand() - 0.5) * ring * 0.4;
        drawLobe(x, y, SPRITE_SIZE * 0.18, SPRITE_SIZE * 0.14, tone.shade, 0.27);
    }
    ctx.globalCompositeOperation = "source-over";

    // 3) ทำขอบให้นุ่ม (ถ้าเบราว์เซอร์รองรับ ctx.filter)
    const softened = document.createElement("canvas");
    softened.width = SPRITE_SIZE;
    softened.height = SPRITE_SIZE;
    const sctx = softened.getContext("2d");
    if (!sctx) return canvas;

    try {
        sctx.filter = "blur(2px)";
    } catch {
        /* ไม่รองรับ — วาดแบบเดิม */
    }
    sctx.drawImage(canvas, 0, 0);
    sctx.filter = "none";
    return softened;
}

function bakeSprites(tone: Tone): HTMLCanvasElement[] {
    const rand = mulberry32(0x5eed1234);
    const sprites: HTMLCanvasElement[] = [];
    for (let i = 0; i < SPRITE_VARIANTS; i++) sprites.push(bakeSprite(rand, tone));
    return sprites;
}

interface Puff {
    x: number;
    y: number;
    size: number;
    sprite: HTMLCanvasElement;
    plane: number;
    drift: number;
    phase: number;
    alpha: number;
    sway: number;
    rotation: number;
}

const PLANE_ALPHA = [0.72, 0.88, 1];
const PLANE_SIZE = [0.88, 1, 1.14];
export interface SmokeField {
    /** กำหนดขนาด canvas (logical px) — ต้องเท่ากับ "กรอบข้อความ + band ทั้ง 2 ด้าน" */
    resize(width: number, height: number, dpr: number): void;
    /** วาด 1 เฟรม (เรียกจาก requestAnimationFrame) */
    paint(timeMs: number): void;
    /** กระเพื่อมเบา ๆ ตอนมีแจ้งเตือนใหม่ */
    pulse(durationMs?: number): void;
    destroy(): void;
}

/** สร้างสนามควันผูกกับ canvas */
export function createSmokeField(canvas: HTMLCanvasElement, options: SmokeOptions): SmokeField {
    const maybeCtx = canvas.getContext("2d");
    const sprites = bakeSprites(TONES[options.tone]);
    const rand = mulberry32(0x1234abcd);

    // ถ้าเบราว์เซอร์ไม่ให้ context (ไม่ควรเกิดกับ OBS/Chrome) → คืน field เปล่า ไม่ให้แอปพัง
    if (!maybeCtx) {
        return {
            resize: () => undefined,
            paint: () => undefined,
            pulse: () => undefined,
            destroy: () => undefined,
        };
    }

    const ctx = maybeCtx;

    let width = 0;
    let height = 0;
    let puffs: Puff[] = [];
    let lastTime = 0;
    let enterUntil = 0;
    let boost = 0;

    function buildPuffs(): void {
        puffs = [];
        if (!width || !height || options.band <= 0) return;

        const inner = {
            x0: options.band,
            y0: options.band,
            x1: Math.max(options.band + 1, width - options.band),
            y1: Math.max(options.band + 1, height - options.band),
        };
        const edges = [
            { x0: inner.x0, y0: inner.y0, x1: inner.x1, y1: inner.y0, nx: 0, ny: -1 },
            { x0: inner.x1, y0: inner.y0, x1: inner.x1, y1: inner.y1, nx: 1, ny: 0 },
            { x0: inner.x0, y0: inner.y1, x1: inner.x1, y1: inner.y1, nx: 0, ny: 1 },
            { x0: inner.x0, y0: inner.y0, x1: inner.x0, y1: inner.y1, nx: -1, ny: 0 },
        ];
        const lengths = edges.map((e) => Math.hypot(e.x1 - e.x0, e.y1 - e.y0));
        const perimeter = lengths.reduce((sum, value) => sum + value, 0);
        const spacing = Math.max(options.band * 0.85, 26);
        const total = Math.max(8, Math.min(80, Math.round((perimeter / spacing) * options.count)));

        for (let i = 0; i < total; i++) {
            const target = ((i + 0.5) / total) * perimeter + (rand() - 0.5) * spacing * 0.6;
            let walked = 0;
            let x = inner.x0;
            let y = inner.y0;
            let nx = 0;
            let ny = -1;

            for (let e = 0; e < edges.length; e++) {
                const length = lengths[e];
                if (walked + length < target) {
                    walked += length;
                    continue;
                }
                const t = length === 0 ? 0 : Math.min(1, Math.max(0, (target - walked) / length));
                const edge = edges[e];
                x = edge.x0 + (edge.x1 - edge.x0) * t;
                y = edge.y0 + (edge.y1 - edge.y0) * t;
                nx = edge.nx;
                ny = edge.ny;
                break;
            }

            const depth = options.band * (0.18 + rand() * 0.85);
            const plane = i % 3;
            const size = options.band * (0.85 + rand() * 0.7) * options.size * PLANE_SIZE[plane];

            puffs.push({
                x: x + nx * depth + (rand() - 0.5) * 6,
                y: y + ny * depth + (rand() - 0.5) * 6,
                size,
                sprite: sprites[i % sprites.length],
                plane,
                drift: 0.05 + rand() * 0.07,
                phase: rand(),
                alpha: (0.3 + rand() * 0.32) * (plane === 0 ? 0.8 : 1),
                sway: 6 + rand() * 12,
                rotation: (rand() - 0.5) * 0.9,
            });
        }
    }

    function paint(timeMs: number): void {
        const dt = lastTime ? Math.min(0.05, (timeMs - lastTime) / 1000) : 0;
        lastTime = timeMs;

        if (timeMs < enterUntil) {
            boost = Math.min(0.45, boost + dt * 2.2);
        } else {
            boost = Math.max(0, boost - dt * 1.4);
        }

        ctx.clearRect(0, 0, width, height);

        for (let plane = 0; plane < 3; plane++) {
            ctx.globalAlpha = Math.min(1, options.opacity * PLANE_ALPHA[plane] * (1 + boost * 0.6));

            for (const puff of puffs) {
                if (puff.plane !== plane) continue;

                puff.phase += dt * puff.drift * (0.35 + options.speed) * (1 + boost);
                if (puff.phase > 1) puff.phase -= 1;

                const envelope = Math.sin(Math.PI * puff.phase);
                const alpha = puff.alpha * envelope;
                if (alpha <= 0.01) continue;

                const x = puff.x + Math.sin((puff.phase + puff.rotation) * Math.PI * 2) * puff.sway;
                const y = puff.y - puff.phase * height * 0.28;
                const size = puff.size * (1 + puff.phase * 0.25) * (1 + boost * 0.25);

                ctx.save();
                ctx.globalAlpha = Math.min(1, alpha * (1 + boost * 0.5));
                ctx.translate(x, y);
                ctx.rotate(puff.rotation);
                ctx.drawImage(puff.sprite, -size / 2, -size / 2, size, size);
                ctx.restore();
            }
        }

        ctx.globalAlpha = 1;
    }

    return {
        resize(nextWidth: number, nextHeight: number, dpr: number): void {
            width = nextWidth;
            height = nextHeight;
            canvas.width = Math.max(1, Math.round(nextWidth * dpr));
            canvas.height = Math.max(1, Math.round(nextHeight * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            buildPuffs();
        },
        paint,
        pulse(durationMs = 600): void {
            enterUntil = performance.now() + durationMs;
            boost = Math.min(0.45, boost + 0.25);
        },
        destroy(): void {
            puffs = [];
            ctx.clearRect(0, 0, width, height);
        },
    };
}
