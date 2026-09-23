"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEventPayload, EmergencyStatus } from "@/types";
import {
  DEFAULT_TTS_PITCH,
  DEFAULT_TTS_RATE,
  buildVoiceDiag,
  loadAvailableVoices,
  planSpeech,
  speakText,
  resolveTtsConfig,
  type TtsConfig,
} from "@/lib/tts/speech-engine";
import { pickThaiVoice, type SpeechVoiceInfo } from "@/lib/tts/voice";

interface VoiceOnlyClientProps {
  token: string;
}

/** จำ alertId ล่าสุดไว้กี่รายการ (กันอ่านซ้ำเมื่อ SSE reconnect) */
const DEDUPE_LIMIT = 20;

/** ข้อความตัวอย่างสำหรับปุ่มทดสอบเสียง (การกดปุ่มยังช่วยปลดล็อกเสียงของเบราว์เซอร์ด้วย) */
const SAMPLE_TEXT = "สวัสดีค่ะ ระบบอ่านข้อความสนับสนุนพร้อมใช้งานแล้ว";

/**
 * โหมด "อ่านเสียงเท่านั้น" (Voice-only) — สำหรับเปิดใน Edge คู่กับ OBS
 *
 * ทำไมต้องมี: OBS (CEF) เห็นเฉพาะเสียงที่ติดตั้งใน Windows (บนเครื่องนี้มีแค่เสียงไทยผู้ชาย)
 * ส่วน Edge มีเสียงผู้หญิงธรรมชาติ (`Microsoft เปรมวดี Online (Natural)`) → ให้ Edge เป็น "คนอ่านเสียง"
 * แล้วตั้ง Browser Source ใน OBS ให้ปิดการอ่านเสียงของตัวเองด้วย `?tts=0`
 *
 * ข้อสำคัญที่โหมดนี้ "ไม่ทำ":
 * - ไม่วาดการ์ดบนจอ (OBS เป็นคนวาด)
 * - ไม่ ACK alert (OBS เป็นคน ACK เพื่อเดินคิว) — จึงไม่แตะตรรกะคิว/ระยะเวลาเดิมเลย
 */
export default function VoiceOnlyClient({ token }: VoiceOnlyClientProps) {
  const [status, setStatus] = useState("กำลังเตรียมเสียง...");
  const [voiceLabel, setVoiceLabel] = useState("—");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastSpoken, setLastSpoken] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [diagLines, setDiagLines] = useState<string[]>([]);
  const [showDiag, setShowDiag] = useState(false);

  const configRef = useRef<TtsConfig>({
    voiceName: null,
    rate: DEFAULT_TTS_RATE,
    pitch: DEFAULT_TTS_PITCH,
    diag: false,
    enabled: true,
  });
  const voicesRef = useRef<SpeechVoiceInfo[]>([]);
  const voiceRef = useRef<SpeechVoiceInfo | null>(null);
  const spokenIdsRef = useRef<string[]>([]);
  const emergencyMutedRef = useRef(false);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  /** ปุ่มทดสอบเสียง — ใช้ตรวจว่าออกเสียงได้จริง + ปลดล็อก autoplay ของเบราว์เซอร์ */
  const testVoice = useCallback((): void => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("เบราว์เซอร์นี้ไม่รองรับการอ่านเสียง");
      return;
    }

    const config = configRef.current;
    const voice = voiceRef.current ?? pickThaiVoice(voicesRef.current, config.voiceName);
    const utterance = speakText(window.speechSynthesis, SAMPLE_TEXT, voice, config);

    speechRef.current = utterance;
    setIsSpeaking(true);
    setStatus("กำลังอ่านเสียงทดสอบ...");

    utterance.onstart = () => setBlocked(false);
    utterance.onend = () => {
      setIsSpeaking(false);
      setStatus("พร้อมอ่านเสียงแล้ว");
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setStatus("อ่านเสียงทดสอบไม่สำเร็จ");
      setBlocked(true);
    };
  }, []);

  /** รับ alert จาก SSE แล้วอ่านออกเสียง (ไม่ ACK — OBS เป็นคน ACK) */
  const handleAlert = useCallback((payload: AlertEventPayload): void => {
    if (emergencyMutedRef.current) return;
    if (spokenIdsRef.current.includes(payload.alertId)) return;

    spokenIdsRef.current = [...spokenIdsRef.current, payload.alertId].slice(-DEDUPE_LIMIT);

    if (!payload.ttsEnabled) {
      setLastSpoken(`(ยอดนี้ไม่เข้าเงื่อนไขอ่านเสียง) ${payload.donorName}`);
      return;
    }

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("เบราว์เซอร์นี้ไม่รองรับการอ่านเสียง");
      return;
    }

    const config = configRef.current;
    const plan = planSpeech(
      { donorName: payload.donorName, amount: payload.amount, message: payload.message },
      voicesRef.current,
      config
    );

    const utterance = speakText(window.speechSynthesis, plan.text, plan.voice, config);

    speechRef.current = utterance;
    setLastSpoken(plan.text);
    setIsSpeaking(true);

    let started = false;
    utterance.onstart = () => {
      started = true;
      setBlocked(false);
      setStatus("กำลังอ่านเสียง...");
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setStatus("พร้อมอ่านเสียงแล้ว");
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setStatus("อ่านเสียงไม่สำเร็จ");
    };

    // ถ้าไม่เริ่มอ่านภายใน 1.5 วินาที = เบราว์เซอร์บล็อกเสียง (ต้องมี user gesture 1 ครั้ง)
    window.setTimeout(() => {
      if (!started) setBlocked(true);
    }, 1500);
  }, []);

  // เตรียมรายชื่อเสียง + อ่านค่าปรับจาก URL (โหลดใหม่เมื่อเบราว์เซอร์แจ้งว่ามีเสียงเปลี่ยน)
  useEffect(() => {
    // ไม่รองรับ TTS = ไม่ต้องทำอะไร (สถานะจะยังเป็น "กำลังเตรียมเสียง..." และจะแจ้งเตือนตอนกดทดสอบเสียง)
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const config = resolveTtsConfig(window.location.search);
    configRef.current = config;

    const synth = window.speechSynthesis;
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      const voices = await loadAvailableVoices(synth);
      if (cancelled) return;

      const picked = pickThaiVoice(voices, config.voiceName);
      voicesRef.current = voices;
      voiceRef.current = picked;

      setVoiceLabel(picked ? `${picked.name} [${picked.lang}]` : "ไม่พบเสียงภาษาไทยในเครื่องนี้");
      setStatus(picked ? "พร้อมอ่านเสียงแล้ว" : "ไม่พบเสียงภาษาไทย — จะใช้เสียง default");
      setDiagLines(buildVoiceDiag(voices, config, picked));
      if (config.diag) setShowDiag(true);
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
  }, []);

  // รับ event จาก SSE: alert = อ่านเสียง · emergency = หยุดอ่านเมื่อถูกสั่งปิด TTS
  useEffect(() => {
    const source = new EventSource(`/api/alerts/stream?token=${encodeURIComponent(token)}`);

    source.addEventListener("alert", (event) => {
      try {
        handleAlert(JSON.parse((event as MessageEvent<string>).data) as AlertEventPayload);
      } catch {
        // payload เพี้ยน — ข้ามรายการนี้ ไม่ให้ทั้งหน้าล้ม
      }
    });

    source.addEventListener("emergency", (event) => {
      try {
        const emergency = JSON.parse((event as MessageEvent<string>).data) as EmergencyStatus;
        emergencyMutedRef.current = emergency.ttsMuted;

        if (emergency.ttsMuted) {
          window.speechSynthesis?.cancel();
          setIsSpeaking(false);
          setStatus("ถูกปิดเสียงชั่วคราว (Emergency)");
        } else {
          setStatus("พร้อมอ่านเสียงแล้ว");
        }
      } catch {
        // ข้าม event ที่ parse ไม่ได้
      }
    });

    source.onopen = () => setStatus((current) => (current === "กำลังเตรียมเสียง..." ? current : "พร้อมอ่านเสียงแล้ว"));
    source.onerror = () => setStatus("การเชื่อมต่อหลุด — กำลังเชื่อมใหม่");

    return () => source.close();
  }, [token, handleAlert]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-200">
      <div className="w-full max-w-[520px] rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="text-lg font-semibold text-white">🎙️ ระบบอ่านเสียง Donate (โหมดเสียงเท่านั้น)</h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          หน้านี้เปิดใน Edge คู่กับ OBS — ตั้ง Browser Source ของ OBS ให้มี <b>?tts=0</b> เพื่อไม่ให้อ่านซ้ำสองเสียง
        </p>

        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="text-xs text-neutral-400">สถานะ</dt>
            <dd className={`mt-0.5 font-medium ${isSpeaking ? "text-emerald-300" : "text-white"}`}>
              {status}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">เสียงที่ใช้</dt>
            <dd className="mt-0.5 break-words">{voiceLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">อ่านล่าสุด</dt>
            <dd className="mt-0.5 break-words text-neutral-300">{lastSpoken || "—"}</dd>
          </div>
        </dl>

        {blocked ? (
          <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            เบราว์เซอร์ยังไม่อนุญาตให้เล่นเสียง — กดปุ่มด้านล่าง 1 ครั้ง (ทำครั้งเดียวต่อการเปิดหน้าต่างนี้)
          </p>
        ) : null}

        <button
          type="button"
          onClick={testVoice}
          className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          ▶ ทดสอบเสียง
        </button>

        {showDiag ? (
          <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-sky-300">
            {diagLines.join("\n")}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
