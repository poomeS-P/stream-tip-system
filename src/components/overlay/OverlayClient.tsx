"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEventPayload, EmergencyStatus } from "@/types";

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
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-lg px-4 pointer-events-none">
      {currentAlert && (
        <div
          className={`
            bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl shadow-2xl p-5
            transition-all duration-500
            ${isVisible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-95"}
          `}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="text-3xl">💜</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-lg leading-tight truncate">
                {currentAlert.donorName}
              </p>
              <p className="text-purple-200 text-sm font-medium">
                บริจาค{" "}
                <span className="text-white font-bold text-base">
                  ฿{currentAlert.amount.toLocaleString("th-TH")}
                </span>
              </p>
            </div>
            {currentAlert.ttsEnabled && !emergency.ttsMuted && (
              <div className="text-2xl animate-pulse">🔊</div>
            )}
          </div>

          {/* Message */}
          {currentAlert.message && !emergency.alertMuted && (
            <div className="bg-white/20 rounded-xl px-4 py-3 text-sm leading-relaxed break-words">
              {currentAlert.hasFilteredWord ? (
                <span className="italic text-yellow-200">{currentAlert.message}</span>
              ) : (
                currentAlert.message
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/70 rounded-full"
              style={{
                animation: isVisible
                  ? `shrink ${currentAlert.durationSeconds}s linear forwards`
                  : "none",
              }}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
