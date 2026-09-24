"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEventPayload, EmergencyStatus } from "@/types";
import {
  DEFAULT_TTS_PITCH,
  DEFAULT_TTS_RATE,
  buildVoiceDiag,
  classifyVoiceSystem,
  formatTtsDecision,
  loadAvailableVoices,
  planTts,
  resolveTtsConfig,
  speakText,
  type TtsConfig,
} from "@/lib/tts/speech-engine";
import { listThaiVoices, pickThaiVoice, type SpeechVoiceInfo } from "@/lib/tts/voice";
import { buildSpeechText } from "@/lib/tts/speech-text";
import type { ClientCounts } from "@/lib/sse";

interface VoiceOnlyClientProps {
  token: string;
}

/** จำ alertId ล่าสุดไว้กี่รายการ (กันอ่านซ้ำเมื่อ SSE reconnect) */
const DEDUPE_LIMIT = 20;

/** ข้อความตัวอย่างสำหรับปุ่มทดสอบเสียง (การกดปุ่มยังช่วยปลดล็อกเสียงของเบราว์เซอร์ด้วย) */
const SAMPLE_TEXT = "สวัสดีค่ะ ระบบอ่านข้อความสนับสนุนพร้อมใช้งานแล้ว";

/**
 * ผลตรวจตัวเองของ "เบราว์เซอร์ที่เปิดหน้านี้" (?ttsselftest=1)
 *
 * ทำไมต้องมี: การมีอยู่ของเสียงหญิงธรรมชาติของ Edge ยืนยันได้จากเบราว์เซอร์จริงเท่านั้น
 * (ไม่ได้ฝังอยู่ในไฟล์ติดตั้ง/โค้ดของโปรเจกต์) → เปิดหน้านี้ใน Edge แล้วอ่านผลได้เลย
 * ตรวจทั้งการเลือกเสียงและกติกา planTts() (auto/local/tts=0/emergency/ไม่มี speechSynthesis)
 */
function buildSelfTestLines(
  voices: readonly SpeechVoiceInfo[],
  picked: SpeechVoiceInfo | null,
  config: TtsConfig,
  preferredDetected: boolean
): string[] {
  const lines: string[] = [];
  const synthAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = userAgent.includes("Edg/") ? "Edge" : userAgent.includes("OBS") ? "OBS/CEF" : "อื่น ๆ";

  const check = (label: string, ok: boolean, detail = ""): void => {
    lines.push(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  };

  lines.push(`เบราว์เซอร์ที่เปิดหน้านี้: ${browser}`);
  lines.push(`speechSynthesis: ${synthAvailable ? "มี" : "ไม่มี"}`);
  lines.push(`เสียงทั้งหมด: ${voices.length} · เสียงไทย: ${listThaiVoices(voices).length}`);

  check(
    "พบเสียงไทยหญิงธรรมชาติ (Edge/online natural) และถูกเลือกอัตโนมัติ",
    preferredDetected,
    picked ? picked.name : "ไม่พบเสียงไทยในเบราว์เซอร์นี้ (จะใช้เสียง default)"
  );

  const base = {
    payloadTtsEnabled: true,
    emergencyTtsMuted: false,
    speechSynthesisAvailable: true,
    voices,
  } as const;

  const withExternal = planTts({ ...base, config, externalVoiceClients: 1 });
  check(
    "โหมด auto + มีตัวอ่านภายนอก (Edge) → หน้าต่าง overlay จะ skip",
    withExternal.action === "skip" && withExternal.reasonCode === "external-voice-client",
    formatTtsDecision(withExternal)
  );

  const forcedLocal = planTts({
    ...base,
    config: { ...config, mode: "local", enabled: true },
    externalVoiceClients: 1,
  });
  check(
    "?tts=local → บังคับให้อ่านจากหน้าต่างนี้",
    forcedLocal.action === "speak",
    formatTtsDecision(forcedLocal)
  );

  const ttsOff = planTts({ ...base, config: { ...config, enabled: false }, externalVoiceClients: 0 });
  check(
    "?tts=0 → skip",
    ttsOff.action === "skip" && ttsOff.reasonCode === "window-tts-off",
    formatTtsDecision(ttsOff)
  );

  const belowThreshold = planTts({ ...base, payloadTtsEnabled: false, config, externalVoiceClients: 0 });
  check(
    "server ส่ง ttsEnabled=false (ยอดไม่ถึงเกณฑ์) → skip",
    belowThreshold.action === "skip" && belowThreshold.reasonCode === "tts-disabled-by-amount",
    formatTtsDecision(belowThreshold)
  );

  const emergency = planTts({ ...base, emergencyTtsMuted: true, config, externalVoiceClients: 0 });
  check(
    "Emergency TTS ปิดอยู่ → skip",
    emergency.action === "skip" && emergency.reasonCode === "emergency-tts-muted",
    formatTtsDecision(emergency)
  );

  const noSynth = planTts({ ...base, speechSynthesisAvailable: false, config, externalVoiceClients: 0 });
  check(
    "เบราว์เซอร์ไม่มี speechSynthesis → skip (ไม่ล้ม)",
    noSynth.action === "skip" && noSynth.reasonCode === "no-speech-synthesis",
    formatTtsDecision(noSynth)
  );

  lines.push("หมายเหตุ: ผลนี้บอกเฉพาะ \"เบราว์เซอร์ที่เปิดหน้านี้\" — ให้เปิดด้วย Edge เพื่อยืนยันเสียงหญิง");

  return lines;
}

/**
 * โหมด "อ่านเสียงเท่านั้น" (Voice-only) — สำหรับเปิดใน Edge คู่กับ OBS
 *
 * บทบาทในระบบ: เป็น "ตัวอ่านเสียงหลัก" (role=voice บน SSE)
 * - Edge มีเสียงหญิงไทยธรรมชาติ (`Microsoft เปรมวดี Online (Natural)`) ที่ OBS/CEF มองไม่เห็น
 * - หน้าต่าง overlay ของ OBS จะ "ไม่อ่านเอง" เมื่อหน้านี้เชื่อมต่ออยู่ (โหมด auto ผ่าน event "presence")
 *   → ไม่ต้องตั้ง `?tts=0` ที่ OBS ก็ไม่มีการอ่านซ้ำ (แต่ยังตั้งได้ถ้าต้องการบังคับ)
 * - ถ้าหน้านี้ปิดไป OBS จะกลับมาอ่านเองด้วยเสียงที่เครื่องมี (fallback: Pattara)
 *
 * ข้อสำคัญที่โหมดนี้ "ไม่ทำ":
 * - ไม่วาดการ์ดบนจอ (OBS เป็นคนวาด)
 * - ไม่ ACK alert (OBS เป็นคน ACK เพื่อเดินคิว) — จึงไม่แตะตรรกะคิว/ระยะเวลาเดิมเลย
 */
export default function VoiceOnlyClient({ token }: VoiceOnlyClientProps) {
  const [status, setStatus] = useState("กำลังเตรียมเสียง...");
  const [voiceLabel, setVoiceLabel] = useState("—");
  const [voiceSystemLabel, setVoiceSystemLabel] = useState("—");
  const [otherReadersLabel, setOtherReadersLabel] = useState("—");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastSpoken, setLastSpoken] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [diagLines, setDiagLines] = useState<string[]>([]);
  const [showDiag, setShowDiag] = useState(false);
  const [selfTestLines, setSelfTestLines] = useState<string[]>([]);
  const [showSelfTest, setShowSelfTest] = useState(false);

  const configRef = useRef<TtsConfig>({
    voiceName: null,
    rate: DEFAULT_TTS_RATE,
    pitch: DEFAULT_TTS_PITCH,
    diag: false,
    enabled: true,
    mode: "auto",
  });
  const voicesRef = useRef<SpeechVoiceInfo[]>([]);
  const voiceRef = useRef<SpeechVoiceInfo | null>(null);
  const spokenIdsRef = useRef<string[]>([]);
  const emergencyMutedRef = useRef(false);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  // จำนวนหน้าต่างอ่านเสียง "อื่น" ที่เชื่อมต่ออยู่ (presence) — ใช้เตือนถ้ามีหลายตัวอ่านซ้ำกัน
  const otherVoiceClientsRef = useRef(0);
  // บรรทัด diag: รายชื่อเสียง (ตั้งค่าตอนโหลดเสียง) + การตัดสินใจล่าสุด (ทับบนสุด)
  const diagBaseRef = useRef<string[]>([]);
  const decisionsRef = useRef<string[]>([]);

  /** รวมเนื้อหาแผง diag = การตัดสินใจล่าสุด + รายชื่อเสียงของเบราว์เซอร์นี้ */
  const renderDiag = useCallback((): void => {
    setDiagLines([
      ...decisionsRef.current,
      ...(decisionsRef.current.length > 0 ? [""] : []),
      ...diagBaseRef.current,
    ]);
  }, []);

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
  const handleAlert = useCallback(
    (payload: AlertEventPayload): void => {
      if (emergencyMutedRef.current) return;
      if (spokenIdsRef.current.includes(payload.alertId)) return;

      spokenIdsRef.current = [...spokenIdsRef.current, payload.alertId].slice(-DEDUPE_LIMIT);

      const config = configRef.current;
      // หน้านี้เป็น "ตัวอ่านเสียงหลัก" → ไม่นับตัวเองเป็นตัวอ่านภายนอก
      const decision = planTts({
        payloadTtsEnabled: payload.ttsEnabled,
        config,
        emergencyTtsMuted: emergencyMutedRef.current,
        speechSynthesisAvailable: typeof window !== "undefined" && "speechSynthesis" in window,
        externalVoiceClients: 0,
        voices: voicesRef.current,
      });

      // log การตัดสินใจ (ระบบเสียงที่เลือก · เหตุผล · fallback) ลงแผง diag
      decisionsRef.current = [formatTtsDecision(decision), ...decisionsRef.current].slice(0, 5);
      renderDiag();

      if (decision.action !== "speak") {
        setLastSpoken(`(ไม่อ่าน: ${decision.reason}) ${payload.donorName}`);
        if (decision.reasonCode === "no-speech-synthesis") {
          setStatus("เบราว์เซอร์นี้ไม่รองรับการอ่านเสียง");
        }
        return;
      }

      const speechText = buildSpeechText({
        donorName: payload.donorName,
        amount: payload.amount,
        message: payload.message,
      });

      try {
        const utterance = speakText(window.speechSynthesis, speechText, decision.voice, config);

        speechRef.current = utterance;
        setLastSpoken(speechText);
        setIsSpeaking(true);
        setStatus("กำลังอ่านเสียง...");

        let started = false;
        utterance.onstart = () => {
          started = true;
          setBlocked(false);
        };
        utterance.onend = () => {
          setIsSpeaking(false);
          setStatus("พร้อมอ่านเสียงแล้ว");
        };
        utterance.onerror = (event) => {
          setIsSpeaking(false);

          const reason = event.error ?? "unknown";
          setStatus(`อ่านเสียงไม่สำเร็จ (${reason})`);

          if (reason !== "canceled" && reason !== "interrupted") {
            decisionsRef.current = [`tts error: ${reason}`, ...decisionsRef.current].slice(0, 5);
            renderDiag();
          }
        };

        // ถ้าไม่เริ่มอ่านภายใน 1.5 วินาที = เบราว์เซอร์บล็อกเสียง (ต้องมี user gesture 1 ครั้ง)
        window.setTimeout(() => {
          if (!started) setBlocked(true);
        }, 1500);
      } catch (error) {
        // TTS ผิดพลาดต้องไม่ทำให้หน้าล้ม (การ์ดเป็นหน้าที่ของ OBS อยู่แล้ว)
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`อ่านเสียงไม่สำเร็จ: ${message}`);
        decisionsRef.current = [`tts speak error: ${message}`, ...decisionsRef.current].slice(0, 5);
        renderDiag();
      }
    },
    [renderDiag]
  );

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

      const system = classifyVoiceSystem(picked);

      setVoiceLabel(picked ? `${picked.name} [${picked.lang}]` : "ไม่พบเสียงภาษาไทยในเครื่องนี้");
      setVoiceSystemLabel(
        `${system.system} — ${system.label}${system.isPreferred ? " (เป้าหมายหลัก ✅)" : system.isFallback ? " (เสียงสำรอง)" : ""}`
      );
      setStatus(
        picked
          ? system.isPreferred
            ? "พร้อมอ่านเสียงแล้ว (เสียงหญิงธรรมชาติของ Edge)"
            : "พร้อมอ่านเสียงแล้ว (เสียงสำรองที่เครื่องนี้มี)"
          : "ไม่พบเสียงภาษาไทย — จะใช้เสียง default"
      );

      // preview การตัดสินใจของหน้าต่างนี้ เพื่อให้แผง diag บอกได้ทันทีว่าจะใช้ระบบเสียงไหน
      const preview = planTts({
        payloadTtsEnabled: true,
        config,
        emergencyTtsMuted: emergencyMutedRef.current,
        speechSynthesisAvailable: true,
        externalVoiceClients: 0,
        voices,
      });

      diagBaseRef.current = buildVoiceDiag(voices, config, picked, preview);
      renderDiag();
      if (config.diag) setShowDiag(true);

      // self-test ของเบราว์เซอร์นี้ (?ttsselftest=1)
      if (new URLSearchParams(window.location.search).get("ttsselftest") === "1") {
        setSelfTestLines(buildSelfTestLines(voices, picked, config, system.isPreferred));
        setShowSelfTest(true);
      }
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
  }, [renderDiag]);

  // รับ event จาก SSE: alert = อ่านเสียง · emergency = หยุดอ่านเมื่อถูกสั่งปิด TTS
  // role=voice → server รู้ว่าหน้านี้เป็น "ตัวอ่านเสียงหลัก" แล้วจะแจ้ง overlay ของ OBS ให้ไม่อ่านซ้ำ
  useEffect(() => {
    const source = new EventSource(`/api/alerts/stream?token=${encodeURIComponent(token)}&role=voice`);

    source.addEventListener("alert", (event) => {
      try {
        handleAlert(JSON.parse((event as MessageEvent<string>).data) as AlertEventPayload);
      } catch {
        // payload เพี้ยน — ข้ามรายการนี้ ไม่ให้ทั้งหน้าล้ม
      }
    });

    /** จำนวน client แยกบทบาท — ใช้เตือนถ้ามีหน้าต่างอ่านเสียงหลายตัว (อาจอ่านซ้ำสองเสียง) */
    source.addEventListener("presence", (event) => {
      try {
        const counts = JSON.parse((event as MessageEvent<string>).data) as ClientCounts;
        const others = Math.max(0, counts.voice - 1);
        otherVoiceClientsRef.current = others;
        setOtherReadersLabel(
          others === 0
            ? "ไม่มี (หน้านี้เป็นตัวอ่านหลัก)"
            : `มีอีก ${others} หน้าต่าง — อาจอ่านซ้ำ ให้ปิดหน้าต่างที่เกิน`
        );
      } catch {
        // ข้าม event ที่ parse ไม่ได้
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
          หน้านี้คือ <b>ตัวอ่านเสียงหลัก</b> (เปิดใน Edge) — ขณะที่เชื่อมต่ออยู่ Browser Source ของ OBS
          จะ<b>ไม่อ่านซ้ำเอง</b>โดยอัตโนมัติ · ถ้าปิดหน้านี้ OBS จะกลับมาอ่านเองด้วยเสียงที่เครื่องมี (fallback)
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
            <dt className="text-xs text-neutral-400">ระบบเสียง</dt>
            <dd className="mt-0.5 break-words text-neutral-300">{voiceSystemLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-400">ตัวอ่านเสียงอื่น</dt>
            <dd className="mt-0.5 break-words text-neutral-300">{otherReadersLabel}</dd>
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

        {/* ผลตรวจตัวเอง (?ttsselftest=1) — ยืนยันจากเบราว์เซอร์จริงของเครื่องนี้ */}
        {showSelfTest ? (
          <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-[11px] leading-relaxed text-emerald-200">
            {selfTestLines.join("\n")}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
