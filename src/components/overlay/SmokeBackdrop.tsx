"use client";

import { useEffect, useRef } from "react";

/**
 * ควันล้อมกรอบข้อความ — ใช้เอนจินตัวเดียวกับการ์ด "แจ้งเตือน Follow" ของระบบเก่า
 * (public/smoke/smoke-engine.js ดึงมาจาก poomes-stream-system/views/alert.html)
 *
 * ทำไมใช้เอนจินเดิม: ลุคต้องเหมือนการ์ด Follow เป๊ะ — สไปรต์ก้อนควัน 3 ระนาบ
 * (หลัง/กลาง/หน้า) + enter pulse + มาสก์ให้ขอบ canvas จางหาย (จึงไม่เห็นกรอบสี่เหลี่ยม)
 *
 * ค่าปรับผ่าน URL ของ overlay (เหมือนระบบเก่า):
 *   ?smoke=A1..C3  พรีเซ็ต round/poof/wisp × Low/Medium/High (ค่าเริ่มต้น A2 = Medium)
 *   ?enterMs=1100  ?exitMs=800   ?smokedev=1 (โหมดตรวจสไปรต์)
 */

/** instance ที่เอนจินควันคืนมา (ใช้เป็น handle + สั่งเปลี่ยนเฟส) */
interface SmokeInstance {
    canvas: HTMLCanvasElement;
    removed: boolean;
    /** "enter" | "idle" | "exit" — ผู้เรียกเป็นคนสั่งเปลี่ยน (เหมือนระบบเก่า) */
    phase: string;
    /** ระยะเฟส enter (วินาที) */
    enterDur: number;
    /** ระยะเฟส exit (วินาที) */
    exitDur: number;
}

/** สัญญาของเอนจินควันใน public/smoke/smoke-engine.js */
interface SmokeEngine {
    spawn(canvas: HTMLCanvasElement, textEl: HTMLElement | null, fill?: Record<string, number>): SmokeInstance;
    release(inst: SmokeInstance | null): void;
    remeasure(inst: SmokeInstance, textEl: HTMLElement | null): void;
    rebuild(inst: SmokeInstance, textEl: HTMLElement | null): void;
}

declare global {
    interface Window {
        StreamSmoke?: SmokeEngine;
    }
}

const ENGINE_URL = "/smoke/smoke-engine.js";

/* ---- ตัวคูณการวาง/ขนาด/จำนวนก้อน (เฉพาะการ์ด "กว้าง-เตี้ย" แบบการ์ดโดเนท) ----
 * ระบบเก่าเจอเรื่องเดียวกันกับการ์ดเป้า (380×98): ขนาดก้อนถูกจำกัดด้วยความสูงของ canvas
 * (unitBase = min(w*0.34, h*0.50)) -> การ์ดยิ่งกว้าง ควันยิ่งไม่เต็มความกว้าง
 * จึงส่ง fill เข้าไปแบบเดียวกับ ?gsmoke* ของการ์ดเป้า (ค่าเริ่มต้นอ้างจาก 1.95/1/1.10/1.85/1)
 *
 * ปรับผ่าน URL ของ overlay: ?smokespreadx= ?smokespready= ?smokesize= ?smokecount= ?smokeop=
 *                          ?smokefit=1 = ปิดตัวคูณ (กลับไปใช้ลุคการ์ดเดิมของพรีเซ็ต ?smoke=)
 */
const FILL_DEFAULTS: Record<string, number> = {
    spreadX: 1.75,
    spreadY: 1.15,
    sizeK: 1.1,
    countK: 1.85,
    opacityK: 1,
};
const FILL_QUERY: Record<string, string> = {
    spreadX: "smokespreadx",
    spreadY: "smokespready",
    sizeK: "smokesize",
    countK: "smokecount",
    opacityK: "smokeop",
};

function readFill(search: string): Record<string, number> | undefined {
    const params = new URLSearchParams(search);
    if (params.get("smokefit") === "1") return undefined;

    const fill: Record<string, number> = {};
    for (const key of Object.keys(FILL_DEFAULTS)) {
        const raw = params.get(FILL_QUERY[key]);
        const value = raw === null ? FILL_DEFAULTS[key] : Number(raw);
        fill[key] = Number.isFinite(value) ? Math.min(3, Math.max(0.2, value)) : FILL_DEFAULTS[key];
    }
    return fill;
}

// โหลดสคริปต์ครั้งเดียวต่อหน้า (สคริปต์คลาสสิกที่ตั้ง window.StreamSmoke)
let enginePromise: Promise<SmokeEngine> | null = null;

function loadSmokeEngine(): Promise<SmokeEngine> {
    if (window.StreamSmoke) return Promise.resolve(window.StreamSmoke);
    if (enginePromise) return enginePromise;

    enginePromise = new Promise<SmokeEngine>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = ENGINE_URL;
        script.async = true;
        script.onload = () => {
            if (window.StreamSmoke) resolve(window.StreamSmoke);
            else reject(new Error("โหลดสคริปต์แล้วแต่ไม่พบ window.StreamSmoke"));
        };
        script.onerror = () => reject(new Error(`โหลด ${ENGINE_URL} ไม่สำเร็จ`));
        document.head.appendChild(script);
    });

    return enginePromise;
}

interface SmokeBackdropProps {
    /** element กรอบข้อความที่ควันล้อมรอบ (ต้องเป็นกล่องเดียวกับที่ข้อความแสดง) */
    textRef: React.RefObject<HTMLElement | null>;
    /** เปิด/ปิดการแสดง — false = ปล่อยควันจางหายตามการ์ด */
    active: boolean;
}

export default function SmokeBackdrop({ textRef, active }: SmokeBackdropProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const engineRef = useRef<SmokeEngine | null>(null);
    const instRef = useRef<SmokeInstance | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const target = textRef.current;
        if (!canvas || !target) return;

        let disposed = false;
        let observer: ResizeObserver | null = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        loadSmokeEngine()
            .then((engine) => {
                if (disposed) return;

                // รอให้ layout ลงตัวก่อนวัด (เอนจินวัดขนาดจาก getBoundingClientRect ของ canvas)
                requestAnimationFrame(() => {
                    if (disposed) return;

                    engineRef.current = engine;
                    const inst = engine.spawn(canvas, target, readFill(window.location.search));
                    instRef.current = inst;

                    // เอนจินไม่เปลี่ยนเฟสเอง — ผู้เรียกสั่ง (แบบเดียวกับ alert.html บรรทัด 2868)
                    idleTimer = setTimeout(() => {
                        if (!disposed && instRef.current === inst) inst.phase = "idle";
                    }, Math.round(inst.enterDur * 1000) + 40);

                    // ข้อความเปลี่ยนขนาด (ชื่อยาว/ฟอนต์โหลดเสร็จ) -> วัดกรอบใหม่ + วางก้อนใหม่
                    if (typeof ResizeObserver === "function") {
                        observer = new ResizeObserver(() => engine.remeasure(inst, target));
                        observer.observe(target);
                    }
                });
            })
            .catch((error: unknown) => {
                console.error("[overlay] เริ่มควันไม่สำเร็จ", error);
            });

        return () => {
            disposed = true;
            observer?.disconnect();
            if (idleTimer !== null) clearTimeout(idleTimer);

            const inst = instRef.current;
            instRef.current = null;
            engineRef.current?.release(inst);
        };
    }, [textRef]);

    // การ์ดเริ่มซ่อน -> ให้ควันหุบกลับเข้าศูนย์ (exit) แล้วค่อยปล่อย instance
    useEffect(() => {
        if (active) return;

        const inst = instRef.current;
        if (!inst) return;

        inst.phase = "exit";
        const timer = setTimeout(() => {
            if (instRef.current === inst) instRef.current = null;
            engineRef.current?.release(inst);
        }, Math.round(inst.exitDur * 1000) + 40);

        return () => clearTimeout(timer);
    }, [active]);

    return (
        <>
            {/* ขอบ canvas กว้างกว่ากรอบข้อความ + mask ให้ขอบนอกสุดจางหาย (คัดจาก alert.html บรรทัด 161-183) */}
            <canvas ref={canvasRef} aria-hidden="true" className="oa-smoke" />
            <style>{`
                .oa-smoke {
                    position: absolute;
                    left: -14%;
                    top: -26%;
                    width: 128%;
                    height: 152%;
                    z-index: 0;
                    pointer-events: none;
                    -webkit-mask-image: radial-gradient(ellipse 50% 58% at 50% 50%, rgba(0, 0, 0, 1) 34%, rgba(0, 0, 0, 0.55) 58%, transparent 82%);
                    mask-image: radial-gradient(ellipse 50% 58% at 50% 50%, rgba(0, 0, 0, 1) 34%, rgba(0, 0, 0, 0.55) 58%, transparent 82%);
                }
            `}</style>
        </>
    );
}
