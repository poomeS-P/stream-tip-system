"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEventPayload, EmergencyStatus } from "@/types";
import SmokeBackdrop from "./SmokeBackdrop";

interface OverlayClientProps {
  token: string;
}

/**
 * สร้างข้อความสำหรับ TTS
 * เป็น pure function จึงประกาศไว้นอก component เพื่อให้ reference คงที่
 * (ไม่ถูกสร้างใหม่ทุก render และไม่ต้องใส่ใน dependency ของ useCallback)
 */
function buildTTSText(payload: AlertEventPayload): string {
  const name = payload.donorName;
  const amount = payload.amount.toLocaleString("th-TH");
  const msg = payload.message?.trim();

  if (msg) {
    return `${name} บริจาค ${amount} บาท ${msg}`;
  }
  return `${name} บริจาค ${amount} บาท`;
}

export default function OverlayClient({ token }: OverlayClientProps) {
  const [currentAlert, setCurrentAlert] = useState<AlertEventPayload | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [emergency, setEmergency] = useState<EmergencyStatus>({ alertMuted: false, ttsMuted: false });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  // กรอบข้อความที่ควันจะล้อมรอบ (ใช้วัดขนาดจริงหลัง render)
  const textRef = useRef<HTMLDivElement | null>(null);

  // ค่า Emergency ล่าสุด — เก็บใน ref เพื่อให้ useCallback ที่ถูกสร้างครั้งเดียว
  // อ่านค่าปัจจุบันได้เสมอ โดยไม่ต้องสร้าง EventSource ใหม่ (ไม่ reconnect)
  const emergencyRef = useRef(emergency);

  // alertId ที่กำลังแสดงอยู่ ใช้สำหรับ ACK เมื่อถูกสั่งซ่อนโดยไม่ระบุ id
  const currentAlertIdRef = useRef<string | null>(null);

  useEffect(() => {
    emergencyRef.current = emergency;
  }, [emergency]);

  const hideAlert = useCallback(
    (alertId?: string) => {
      setIsVisible(false);
      window.speechSynthesis?.cancel();

      // ACK กลับไปยัง Server พร้อม Overlay Token (ต้องมี token จึงจะ ACK ได้)
      const id = alertId ?? currentAlertIdRef.current;
      currentAlertIdRef.current = null;

      if (id) {
        fetch(`/api/alerts/ack?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId: id }),
        }).catch(() => {});
      }

      // รอให้ animation ออกจบก่อนล้าง state
      setTimeout(() => setCurrentAlert(null), 600);
    },
    [token]
  );

  const showAlert = useCallback(
    (payload: AlertEventPayload) => {
      // ถ้า Emergency muted ไม่แสดง
      if (emergencyRef.current.alertMuted) return;

      // ยกเลิก timeout เก่า
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      setCurrentAlert(payload);
      setIsVisible(true);
      currentAlertIdRef.current = payload.alertId;

      // เล่นเสียง Alert Sound
      const audio = new Audio(payload.soundUrl);
      audio.volume = 0.8;
      audio.play().catch(() => {/* autoplay policy */});

      // TTS
      const shouldTTS = payload.ttsEnabled && !emergencyRef.current.ttsMuted;
      const ttsDelay = 800; // รอให้ animation เด้งขึ้นก่อน

      if (shouldTTS && "speechSynthesis" in window) {
        setTimeout(() => {
          const text = buildTTSText(payload);
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = "th-TH";
          utter.rate = 0.9;
          utter.pitch = 1.1;
          utter.volume = 1.0;
          speechRef.current = utter;
          window.speechSynthesis.cancel(); // ยกเลิก TTS ที่ค้างอยู่
          window.speechSynthesis.speak(utter);
        }, ttsDelay);
      }

      // ซ่อนหลังจาก duration
      timeoutRef.current = setTimeout(() => {
        hideAlert(payload.alertId);
      }, (payload.durationSeconds + 1) * 1000);
    },
    [hideAlert]
  );

  // เชื่อมต่อ SSE — ประกาศหลัง useCallback ทั้งหมด เพื่อให้ตัวแปรถูก declare ก่อนถูกใช้งาน
  useEffect(() => {
    function connect() {
      // encodeURIComponent สำคัญมาก: ถ้า token มี "+" แล้วใส่ดิบ ๆ
      // ตัว "+" ใน query string จะถูกตีความเป็น "เว้นวรรค" → server เทียบ token ไม่ตรง (401)
      const es = new EventSource(`/api/alerts/stream?token=${encodeURIComponent(token)}`);
      eventSourceRef.current = es;

      es.addEventListener("alert", (e) => {
        try {
          const payload: AlertEventPayload = JSON.parse(e.data);
          showAlert(payload);
        } catch {
          console.error("[overlay] Failed to parse alert event");
        }
      });

      es.addEventListener("emergency", (e) => {
        try {
          const status: EmergencyStatus = JSON.parse(e.data);
          setEmergency(status);
          if (status.alertMuted) {
            hideAlert();
          }
          if (status.ttsMuted) {
            window.speechSynthesis?.cancel();
          }
        } catch {
          console.error("[overlay] Failed to parse emergency event");
        }
      });

      es.onerror = () => {
        es.close();
        // Auto-reconnect ใน 3 วินาที
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [token, showAlert, hideAlert]);

  return (
    <div className="fixed inset-x-0 bottom-0 flex justify-center pb-24 pointer-events-none">
      {currentAlert && (
        <div
          className={`relative transition-all duration-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          {/* ควันรอบกรอบข้อความ — ไม่มีพื้นหลัง */}
          <SmokeBackdrop targetRef={textRef} pulseKey={currentAlert.alertId} active={isVisible} />

          <div ref={textRef} className="oa-text relative z-10 max-w-[1180px]">
            {/* บรรทัดที่ 1: ชื่อ + โดเนทมา + จำนวนเงิน */}
            <p className="oa-line1">
              <span className="oa-name">{currentAlert.donorName}</span>
              <span className="oa-verb">โดเนทมา</span>
              <span className="oa-amount">฿{currentAlert.amount.toLocaleString("th-TH")}</span>
            </p>

            {/* บรรทัดที่ 2: ข้อความ */}
            {currentAlert.message && (
              <p className={`oa-message${currentAlert.hasFilteredWord ? " oa-message--muted" : ""}`}>
                {currentAlert.message}
              </p>
            )}
          </div>

          <style>{`
            .oa-text {
              font-family: "Noto Sans Thai", "Leelawadee UI", "Sarabun", "Segoe UI", system-ui, sans-serif;
              text-align: center;
              line-height: 1.18;
            }
            .oa-line1 {
              margin: 0;
              display: flex;
              align-items: baseline;
              justify-content: center;
              gap: 0.42em;
              flex-wrap: wrap;
              font-size: clamp(30px, 3.4vw, 56px);
              font-weight: 800;
              color: #ffffff;
              text-shadow:
                0 2px 10px rgba(0, 0, 0, 0.92),
                0 0 32px rgba(0, 0, 0, 0.6),
                0 1px 2px rgba(0, 0, 0, 0.95);
            }
            .oa-name { color: #ffffff; }
            .oa-verb {
              font-size: 0.7em;
              font-weight: 600;
              color: #e9eef8;
            }
            .oa-amount { color: #ffd76a; }
            .oa-message {
              margin: 0.34em 0 0;
              font-size: clamp(19px, 1.9vw, 34px);
              font-weight: 500;
              color: #f3f6fc;
              overflow-wrap: anywhere;
              text-shadow:
                0 2px 8px rgba(0, 0, 0, 0.92),
                0 0 24px rgba(0, 0, 0, 0.55);
              display: -webkit-box;
              -webkit-line-clamp: 3;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .oa-message--muted {
              font-style: italic;
              color: #ffe8a3;
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
