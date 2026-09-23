"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEventPayload, EmergencyStatus } from "@/types";
import SmokeBackdrop from "./SmokeBackdrop";
import {
  DEFAULT_TTS_PITCH,
  DEFAULT_TTS_RATE,
  buildVoiceDiag,
  loadAvailableVoices,
  planSpeech,
  resolveTtsConfig,
  speakText,
  type TtsConfig,
} from "@/lib/tts/speech-engine";
import { pickThaiVoice, type SpeechVoiceInfo } from "@/lib/tts/voice";

interface OverlayClientProps {
  token: string;
}

/** จำนวน Alert สูงสุดที่รอคิวได้ (กันคิวบวมผิดปกติ) */
const MAX_QUEUE = 10;

/** เว้นช่วงก่อนเริ่มรายการถัดไป (ให้ animation ออกของการ์ดเดิมจบก่อน) */
const EXIT_MS = 600;

/** เวลาที่สั้นที่สุด/นานที่สุดที่ยอมให้ Alert ค้างบนจอ (กันขึ้นแวบเดียว หรือค้างยาวผิดปกติ) */
const MIN_DISPLAY_MS = 3000;
const MAX_DISPLAY_MS = 60_000;

declare global {
  interface Window {
    /** ไทม์ไลน์สำหรับวินิจฉัย (?alertdiag=1 เพื่อโชว์บนจอ) */
    __alertLog?: string[];
  }
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

/**
 * เวลาที่จะค้างบนจอ (ms)
 * - ใช้ค่าที่ Server คำนวณมา (ปรับตามความยาวข้อความแล้ว) ถ้าค่าถูกต้อง
 * - ถ้าค่าเสีย/ไม่มี (NaN, 0, ติดลบ) ให้ประมาณจากความยาวข้อความเอง
 *   สำคัญ: กัน setTimeout(fn, NaN) ซึ่งจะยิงทันที -> การ์ดขึ้นแวบเดียวแล้วหาย
 */
function resolveDisplayMs(payload: AlertEventPayload): number {
  const seconds = Number(payload.durationSeconds);

  if (Number.isFinite(seconds) && seconds * 1000 >= MIN_DISPLAY_MS) {
    return Math.min(MAX_DISPLAY_MS, seconds * 1000);
  }

  const chars = buildTTSText(payload).length;
  const estimated = 2500 + chars * 110;

  return Math.max(MIN_DISPLAY_MS, Math.min(MAX_DISPLAY_MS, estimated));
}

export default function OverlayClient({ token }: OverlayClientProps) {
  const [currentAlert, setCurrentAlert] = useState<AlertEventPayload | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [emergency, setEmergency] = useState<EmergencyStatus>({ alertMuted: false, ttsMuted: false });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  // ---------- ระบบเสียงอ่าน (TTS) ----------
  // ค่าปรับอ่านจาก URL (?ttsvoice= ?ttsrate= ?ttspitch= ?ttsdiag=1) — เก็บใน ref
  // เพื่อให้ useCallback ที่ถูกสร้างครั้งเดียวอ่านค่าใหม่ได้เสมอ
  const ttsConfigRef = useRef<TtsConfig>({
    voiceName: null,
    rate: DEFAULT_TTS_RATE,
    pitch: DEFAULT_TTS_PITCH,
    diag: false,
    enabled: true,
  });
  // รายชื่อเสียงทั้งหมดของเครื่องนี้ + เสียงไทยที่เลือกไว้
  const ttsVoicesRef = useRef<SpeechVoiceInfo[]>([]);
  const ttsVoiceRef = useRef<SpeechVoiceInfo | null>(null);
  // บรรทัดสรุปสำหรับแผง ?ttsdiag=1 (เก็บใน ref แล้วให้ interval ดึงไปแสดง — กัน pattern setState ใน effect)
  const ttsDiagLinesRef = useRef<string[]>([]);
  const [ttsDiagLines, setTtsDiagLines] = useState<string[]>([]);
  const [showTtsDiag, setShowTtsDiag] = useState(false);
  // กรอบข้อความที่ควันล้อมรอบ (เอนจินวัดขนาดจริงจาก element นี้)
  const textRef = useRef<HTMLDivElement | null>(null);

  // ค่า Emergency ล่าสุด — เก็บใน ref เพื่อให้ useCallback ที่ถูกสร้างครั้งเดียว
  // อ่านค่าปัจจุบันได้เสมอ โดยไม่ต้องสร้าง EventSource ใหม่ (ไม่ reconnect)
  const emergencyRef = useRef(emergency);

  // alertId ที่กำลังแสดงอยู่ ใช้สำหรับ ACK เมื่อถูกสั่งซ่อนโดยไม่ระบุ id
  const currentAlertIdRef = useRef<string | null>(null);

  // คิว Alert ฝั่ง Overlay — โดเนทมาพร้อมกันต้องเล่นเรียงกัน ไม่ทับกันจนอันหนึ่งหาย
  const queueRef = useRef<AlertEventPayload[]>([]);
  const busyRef = useRef(false);
  // อ้างฟังก์ชันผ่าน ref เพื่อให้ playAlert/finishAlert เรียกกันเองได้โดยไม่เกิด dependency วน
  const playRef = useRef<(payload: AlertEventPayload) => void>(() => {});
  const finishRef = useRef<(alertId?: string) => void>(() => {});

  // กัน timer ที่ค้างจากรอบก่อนมายิงทับรายการปัจจุบัน (อาการ "อันที่ 2 ขึ้นแวบเดียวแล้วหาย")
  const epochRef = useRef(0);
  const drainRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // โหมดวินิจฉัย: ดูไทม์ไลน์บนจอได้ด้วย ?alertdiag=1
  const [diagLines, setDiagLines] = useState<string[]>([]);
  const [showDiag, setShowDiag] = useState(false);

  const logDiag = useCallback((line: string) => {
    if (typeof window === "undefined") return;

    window.__alertLog = window.__alertLog ?? [];
    window.__alertLog.push(`${Math.round(performance.now())}ms ${line}`);

    if (window.__alertLog.length > 60) window.__alertLog.shift();
  }, []);

  useEffect(() => {
    emergencyRef.current = emergency;
  }, [emergency]);

  /**
   * อ่านค่าปรับเสียงจาก URL + โหลดรายชื่อเสียงของเครื่องนี้
   * (โหลดซ้ำเมื่อเบราว์เซอร์ยิง "voiceschanged" เช่นหลังติดตั้งเสียงใหม่)
   * ไม่แตะตรรกะคิว/ACK — แค่เตรียม "เสียงที่จะใช้อ่าน" ให้พร้อม
   */
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const config = resolveTtsConfig(window.location.search);
    ttsConfigRef.current = config;

    const synth = window.speechSynthesis;
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      const voices = await loadAvailableVoices(synth);
      if (cancelled) return;

      const picked = pickThaiVoice(voices, config.voiceName);

      ttsVoicesRef.current = voices;
      ttsVoiceRef.current = picked;

      const lines = buildVoiceDiag(voices, config, picked);
      ttsDiagLinesRef.current = lines;
      lines.forEach((line) => logDiag(`tts ${line}`));
    };

    void refresh();

    const handleVoicesChanged = (): void => {
      void refresh();
    };

    synth.addEventListener("voiceschanged", handleVoicesChanged);
    return () => {
      cancelled = true;
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
    };
  }, [logDiag]);

  // แผงรายชื่อเสียง (?ttsdiag=1) — ดึงค่าไปแสดงเป็นช่วง ๆ เหมือนแผงไทม์ไลน์ด้านล่าง
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ttsdiag") !== "1") return;

    const timer = setInterval(() => {
      setTtsDiagLines([...ttsDiagLinesRef.current]);
      setShowTtsDiag(true);
    }, 500);

    return () => clearInterval(timer);
  }, []);

  /** ACK กลับ Server พร้อม Overlay Token (แจ้งว่าแสดงจบแล้ว -> Server จะส่งรายการถัดไปในคิว) */
  const ackAlert = useCallback(
    (alertId: string) => {
      fetch(`/api/alerts/ack?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      }).catch(() => {});
    },
    [token]
  );

  /** เริ่มแสดง Alert หนึ่งรายการ (เสียง + TTS + ตั้งเวลาปิดเอง) */
  const playAlert = useCallback((payload: AlertEventPayload) => {
    // เริ่มรอบใหม่: ยกเลิก timer ปิด/drain ที่ค้างอยู่ + ออก epoch ใหม่
    // -> timer ของรายการก่อนหน้าจะปิดรายการนี้ไม่ได้อีก
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (drainRef.current) {
      clearTimeout(drainRef.current);
      drainRef.current = null;
    }

    epochRef.current += 1;
    const epoch = epochRef.current;

    busyRef.current = true;
    setCurrentAlert(payload);
    setIsVisible(true);
    currentAlertIdRef.current = payload.alertId;

    const displayMs = resolveDisplayMs(payload);
    logDiag(`play ${payload.donorName} ${displayMs}ms (รอคิว ${queueRef.current.length})`);

    // เล่นเสียง Alert Sound
    const audio = new Audio(payload.soundUrl);
    audio.volume = 0.8;
    audio.play().catch(() => {/* autoplay policy */});

    // TTS (รอให้ animation เด้งขึ้นก่อน)
    // - เลือกเสียงไทยผู้หญิง/ธรรมชาติจากรายชื่อเสียงจริงของเครื่อง (ดู src/lib/tts/voice.ts)
    // - อ่านตัวเลขเป็นคำไทย + ตัด emoji/★/URL (ดู src/lib/tts/speech-text.ts)
    // - rate/pitch กลาง ๆ นุ่มนวล ปรับได้ท้าย URL (?ttsrate= ?ttspitch= ?ttsvoice=)
    // - ปิดการอ่านเสียงของหน้าต่างนี้ได้ด้วย ?tts=0 (ใช้เมื่อให้หน้าต่างอื่น เช่น Edge เป็นคนอ่าน)
    const ttsConfig = ttsConfigRef.current;
    const shouldTTS = payload.ttsEnabled && ttsConfig.enabled && !emergencyRef.current.ttsMuted;

    if (shouldTTS && "speechSynthesis" in window) {
      const plan = planSpeech(
        { donorName: payload.donorName, amount: payload.amount, message: payload.message },
        ttsVoicesRef.current,
        ttsConfig
      );

      logDiag(`tts "${plan.text}" → ${plan.voiceName ?? "default voice"}`);

      setTimeout(() => {
        speechRef.current = speakText(window.speechSynthesis, plan.text, plan.voice, ttsConfig);
      }, 800);
    }

    timeoutRef.current = setTimeout(() => {
      if (epochRef.current !== epoch) return;      // มีรายการใหม่กว่าเริ่มไปแล้ว -> ห้ามปิด
      finishRef.current(payload.alertId);
    }, displayMs);
  }, [logDiag]);

  /** จบ Alert ปัจจุบัน -> ACK -> เล่นรายการถัดไปในคิว (ถ้ามี) */
  const finishAlert = useCallback(
    (alertId?: string) => {
      const current = currentAlertIdRef.current;

      // timer ปิดของรายการเก่ามายิงช้า -> ต้องไม่ไปปิดรายการที่กำลังแสดงอยู่
      if (alertId && alertId !== current) return;

      const id = alertId ?? current;
      const epoch = epochRef.current;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (drainRef.current) {
        clearTimeout(drainRef.current);
        drainRef.current = null;
      }

      setIsVisible(false);
      window.speechSynthesis?.cancel();
      currentAlertIdRef.current = null;
      logDiag(`finish ${id ?? "-"}`);

      if (id) ackAlert(id);

      // รอให้การ์ดเดิมจางหายก่อน แล้วจึงเริ่มรายการถัดไป
      drainRef.current = setTimeout(() => {
        drainRef.current = null;

        if (epochRef.current !== epoch) return;    // มีรายการใหม่เริ่มไปแล้ว -> อย่าไปยุ่ง

        const next = queueRef.current.shift();

        if (next) {
          playRef.current(next);
          return;
        }

        busyRef.current = false;
        setCurrentAlert(null);
        logDiag("idle (คิวว่าง)");
      }, EXIT_MS);
    },
    [ackAlert, logDiag]
  );

  useEffect(() => {
    playRef.current = playAlert;
    finishRef.current = finishAlert;
  }, [playAlert, finishAlert]);

  /**
   * รับ Alert จาก SSE
   * - ว่าง -> เล่นทันที
   * - กำลังเล่นอยู่ -> ต่อคิว (ไม่ทับกัน ทำให้โดเนทพร้อมกันไม่หาย)
   * - ซ้ำ (alertId เดิม) -> ข้าม (Server อาจส่งซ้ำได้จาก reconnect/ACK chain)
   */
  const enqueueAlert = useCallback((payload: AlertEventPayload) => {
    if (emergencyRef.current.alertMuted) return;
    if (currentAlertIdRef.current === payload.alertId) return;
    if (queueRef.current.some((item) => item.alertId === payload.alertId)) return;

    if (busyRef.current) {
      if (queueRef.current.length < MAX_QUEUE) {
        queueRef.current.push(payload);
        logDiag(`queue +1 ${payload.donorName} (รวม ${queueRef.current.length})`);
      }
      return;
    }

    playRef.current(payload);
  }, [logDiag]);

  // โหมดวินิจฉัย (?alertdiag=1): โชว์ไทม์ไลน์มุมล่างซ้าย เพื่อดูว่าใครปิดการ์ด
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("alertdiag") !== "1") return;

    const timer = setInterval(() => {
      setDiagLines([...(window.__alertLog ?? [])]);
      setShowDiag(true);
    }, 500);

    return () => clearInterval(timer);
  }, []);

  // เชื่อมต่อ SSE — ประกาศหลัง useCallback ทั้งหมด เพื่อให้ตัวแปรถูก declare ก่อนถูกใช้งาน
  useEffect(() => {
    function connect() {
      // encodeURIComponent สำคัญมาก: ถ้า token มี "+" แล้วไม่ดิบ ๆ
      // ตัว "+" ใน query string จะถูกตีความเป็น "เว้นวรรค" → server เทียบ token ไม่ตรง (401)
      const es = new EventSource(`/api/alerts/stream?token=${encodeURIComponent(token)}`);
      eventSourceRef.current = es;

      es.addEventListener("alert", (e) => {
        try {
          const payload: AlertEventPayload = JSON.parse(e.data);
          enqueueAlert(payload);
        } catch {
          console.error("[overlay] Failed to parse alert event");
        }
      });

      es.addEventListener("emergency", (e) => {
        try {
          const status: EmergencyStatus = JSON.parse(e.data);
          setEmergency(status);

          if (status.alertMuted) {
            // ปิดฉุกเฉิน: ทิ้งคิวที่รออยู่ แล้วปิดการ์ดปัจจุบัน (พร้อม ACK กลับ Server)
            queueRef.current = [];
            finishRef.current();
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
  }, [token, enqueueAlert]);

  return (
    <div className="fixed inset-x-0 bottom-0 flex justify-center pb-24 pointer-events-none">
      {currentAlert && (
        <div
          className={`relative transition-all duration-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          {/* ควันล้อมกรอบข้อความ — เอนจินตัวเดียวกับการ์ดแจ้งเตือน Follow (key = เริ่มควันชุดใหม่ทุกครั้งที่มีโดเนท) */}
          <SmokeBackdrop key={currentAlert.alertId} textRef={textRef} active={isVisible} />

          {/* ข้อความล้วน ไม่มีพื้นหลัง */}
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

      {/* ไทม์ไลน์วินิจฉัย — แสดงเฉพาะเมื่อเติม ?alertdiag=1 ท้าย URL */}
      {showDiag && (
        <pre className="fixed bottom-2 left-2 z-50 max-w-[620px] whitespace-pre-wrap rounded bg-black/75 p-2 text-left text-[11px] leading-tight text-lime-300">
          {diagLines.join("\n")}
        </pre>
      )}
      {/* แผงรายชื่อเสียงอ่าน — แสดงเฉพาะเมื่อเติม ?ttsdiag=1 ท้าย URL */}
      {showTtsDiag && (
        <pre className="fixed right-2 bottom-2 z-50 max-w-[560px] whitespace-pre-wrap rounded bg-black/75 p-2 text-left text-[11px] leading-tight text-sky-300">
          {ttsDiagLines.join("\n")}
        </pre>
      )}
    </div>
  );
}

