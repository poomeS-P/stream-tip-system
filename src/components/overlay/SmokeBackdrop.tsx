"use client";

import { useEffect, useRef } from "react";
import { createSmokeField, readSmokeOptions } from "./smoke";

interface SmokeBackdropProps {
    /** element ที่ควันจะล้อมรอบ (กรอบข้อความ) */
    targetRef: React.RefObject<HTMLElement | null>;
    /** เปลี่ยนค่า = กระเพื่อมควันเบา ๆ (ส่ง alertId ลงมา) */
    pulseKey: string;
    /** เปิด/ปิดการวาด (หยุด rAF เมื่อไม่แสดง → ประหยัด CPU ใน OBS) */
    active: boolean;
}

/**
 * ควันรอบกรอบข้อความ — ไม่มีพื้นหลัง
 *
 * - ขนาด canvas = กรอบข้อความ + band ทั้ง 2 ด้าน (อ่าน band จาก query ?smokeband=)
 * - วัดขนาดใหม่ทุกครั้งที่ข้อความเปลี่ยนขนาด (ResizeObserver)
 * - อ่านค่าปรับจาก URL: ?smokesize= ?smokecount= ?smokeop= ?smokespeed= ?smokeband= ?smoketone=
 */
export default function SmokeBackdrop({ targetRef, pulseKey, active }: SmokeBackdropProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const fieldRef = useRef<ReturnType<typeof createSmokeField> | null>(null);
    const frameRef = useRef<number | null>(null);
    const bandRef = useRef<number>(52);

    useEffect(() => {
        const canvas = canvasRef.current;
        const target = targetRef.current;
        if (!canvas || !target) return;

        const options = readSmokeOptions(window.location.search);
        bandRef.current = options.band;

        const field = createSmokeField(canvas, options);
        fieldRef.current = field;

        const measure = (): void => {
            const rect = target.getBoundingClientRect();
            const band = bandRef.current;
            const width = Math.max(1, rect.width + band * 2);
            const height = Math.max(1, rect.height + band * 2);

            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            canvas.style.left = `${-band}px`;
            canvas.style.top = `${-band}px`;

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            field.resize(width, height, dpr);
        };

        measure();

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver === "function") {
            observer = new ResizeObserver(measure);
            observer.observe(target);
        }

        return () => {
            observer?.disconnect();
            field.destroy();
            fieldRef.current = null;
        };
    }, [targetRef]);

    // กระเพื่อมเมื่อมีแจ้งเตือนใหม่
    useEffect(() => {
        if (pulseKey) fieldRef.current?.pulse(700);
    }, [pulseKey]);

    // วาดเฉพาะตอนแสดงอยู่
    useEffect(() => {
        if (!active) {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            return;
        }

        const loop = (time: number): void => {
            fieldRef.current?.paint(time);
            frameRef.current = requestAnimationFrame(loop);
        };
        frameRef.current = requestAnimationFrame(loop);

        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [active]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute z-0 pointer-events-none"
            style={{ left: 0, top: 0 }}
        />
    );
}
