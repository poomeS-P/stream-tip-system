"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import SmokeBackdrop from "./SmokeBackdrop";
import type { TopDonor, TopDonorsResult } from "@/lib/top-donors";

/**
 * Top Donate Podium — ผู้สนับสนุนยอดสะสมสูงสุด 3 อันดับ
 *
 * ดีไซน์: ยึดภาษาเดิมของ Overlay (การ์ด Last Follow / Goal)
 *  - ตำแหน่ง + ความกว้างชุดเดียวกับการ์ด Last Follow (bottom-left · calc(min(28vw,460px) * .82))
 *  - ควัน = เอนจินเดิม (SmokeBackdrop) ย้อมสีเฉพาะช่องด้วย CSS filter (ทอง/เงิน/ทองแดง)
 *  - แท่น = frosted glass token เดิม (gradient + blur(7px) saturate(1.05) + hairline ring)
 *  - เลขอันดับเป็น typography (01/02/03) ไม่ใช้ emoji และไม่เขียนคำ Gold/Silver/Bronze บน UI
 *
 * กติกาข้อมูล: นับเฉพาะยอดจริง (ดู src/lib/top-donors.ts) · 匿名 → "ไม่ระบุชื่อ"
 * ช่องที่ยังไม่มีอันดับ 2/3 = เว้นว่างสนิท (ไม่มีชื่อ/ยอด/แท่น/ควัน) แต่ยังกันพื้นที่ → ตำแหน่ง 01 ไม่ขยับ
 */

interface PodiumClientProps {
  token: string;
  /** ข้อมูลชุดแรกจาก server (SSR) — เปิดหน้าแล้วเห็นทันที ไม่ต้องรอ fetch */
  initial: TopDonorsResult | null;
}

type PodiumPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";

interface PodiumConfig {
  position: PodiumPosition;
  /** >0 = ปักความกว้างเป็น px (เหมือน ?latestwidthpx= ของระบบเดิม) */
  widthPx: number;
  /** >0 = ปักระยะห่างจากขอบเป็น px (เหมือน ?latestpadpx=) */
  padPx: number;
  scale: number;
  tints: Record<1 | 2 | 3, string>;
  /** true = ใช้กับ dev เท่านั้น (นับยอดทดสอบด้วย) */
  includeTest: boolean;
  diag: boolean;
}

/** ย้อมสีควันต่ออันดับด้วย CSS filter — ค่าปัจจุบันถูกออกแบบให้เห็นความต่างชัดแต่ยัง "พรีเมียม" */
const DEFAULT_TINTS: Record<1 | 2 | 3, string> = {
  1: "sepia(.86) saturate(2.7) hue-rotate(-10deg) brightness(1.06)",
  2: "sepia(.20) saturate(.55) brightness(1.09)",
  3: "sepia(.92) saturate(1.95) hue-rotate(14deg) brightness(.95)",
};

/** ความกว้างการ์ด Last Follow ของระบบเดิม: calc(min(28vw,460px) * .82) ≈ 380px ที่ 1920 */
const LATEST_SCALE = 0.82;
const REFERENCE_WIDTH_PX = 380;

/**
 * ค่าเริ่มต้นของ Podium — ใช้เมื่อ "ยังไม่รู้ URL ของเบราว์เซอร์" (ตอน SSR/เฟรมแรก)
 * ค่าที่ตรงกับค่าเริ่มต้นจริงของการ์ด Last Follow: มุมล่างซ้าย · ความกว้างตามสูตรเดิม · ไม่ปัก px
 */
const DEFAULT_CONFIG: PodiumConfig = {
  position: "bottom-left",
  widthPx: 0,
  padPx: 0,
  scale: 1,
  tints: DEFAULT_TINTS,
  includeTest: false,
  diag: false,
};

const POSITIONS: readonly PodiumPosition[] = ["bottom-left", "bottom-right", "top-left", "top-right"];

function readNum(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** อ่านค่าปรับจาก URL ของหน้า Podium (รองรับชื่อพารามิเตอร์ของการ์ดเดิมด้วย เช่น latestwidthpx) */
function readPodiumConfig(search: string): PodiumConfig {
  const params = new URLSearchParams(search);
  const posRaw = (params.get("podiumposition") ?? params.get("latestposition") ?? "bottom-left").toLowerCase();
  const position = (POSITIONS as readonly string[]).includes(posRaw) ? (posRaw as PodiumPosition) : "bottom-left";

  const widthPx = Math.round(readNum(params, "podiumwidthpx", readNum(params, "latestwidthpx", 0)));
  const padPx = Math.round(readNum(params, "podiumpadpx", readNum(params, "latestpadpx", 0)));

  const scaleRaw = Number(params.get("podiumscale"));
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0.2 && scaleRaw <= 3 ? scaleRaw : 1;

  const tint = (key: string, fallback: string): string => {
    const value = params.get(key);
    if (value === null) return fallback;

    const trimmed = value.trim();
    if (trimmed === "") return fallback;
    if (trimmed === "0" || trimmed.toLowerCase() === "none") return "none";

    return trimmed;
  };

  return {
    position,
    widthPx,
    padPx,
    scale,
    tints: {
      1: tint("tint1", DEFAULT_TINTS[1]),
      2: tint("tint2", DEFAULT_TINTS[2]),
      3: tint("tint3", DEFAULT_TINTS[3]),
    },
    includeTest: params.get("includetest") === "1" || params.get("includeTest") === "1",
    diag: params.get("podiumdiag") === "1",
  };
}

/* ------------------------------------------------------------------
 * อ่านค่าปรับจาก URL ระหว่าง render ด้วย useSyncExternalStore
 * (ไม่ใช้ setState ใน effect → ไม่เกิด cascading render และไม่ hydration mismatch)
 * ------------------------------------------------------------------ */

/** URL ของหน้านิ่งตลอดอายุหน้า → ไม่มีอะไรต้อง subscribe */
function subscribeToConfig(): () => void {
  return () => {};
}

/** cache ระดับโมดูล: getSnapshot ต้องคืนค่าเดิมเมื่อค่าไม่เปลี่ยน (กัน React เตือน/loop) */
let cachedSearch: string | null = null;
let cachedConfig: PodiumConfig | null = null;

function getClientPodiumConfig(): PodiumConfig | null {
  if (typeof window === "undefined") return null;

  const search = window.location.search;
  if (cachedSearch !== search || !cachedConfig) {
    cachedSearch = search;
    cachedConfig = readPodiumConfig(search);
  }

  return cachedConfig;
}

/** ฝั่ง server ไม่มี URL ของเบราว์เซอร์ → คืน null (HTML ที่ SSR มากับ client จะตรงกัน) */
function getServerPodiumConfig(): PodiumConfig | null {
  return null;
}

interface PodiumSlotProps {
  donor: TopDonor | null;
  tint: string;
  variant: "center" | "side";
}
/** หนึ่งช่องของ Podium — donor = null คือ "ช่องว่างที่ยังไม่มีอันดับ" */
function PodiumSlot({ donor, tint, variant }: PodiumSlotProps) {
  const figureRef = useRef<HTMLDivElement | null>(null);

  // ยังไม่มีอันดับนี้ → เว้นว่างสนิท (ไม่มีชื่อ/ยอด/แท่น/ควัน) แต่คง track ไว้ให้ตำแหน่งไม่ขยับ
  if (!donor) {
    return <div className="podium-slot" data-empty="1" aria-hidden="true" />;
  }

  return (
    <div
      className="podium-slot"
      data-rank={donor.rank}
      data-variant={variant}
      data-anonymous={donor.anonymous ? "1" : "0"}
      style={{ "--slot-tint": tint } as CSSProperties}
    >
      <div className="podium-figure" ref={figureRef}>
        {/* ควันชุดเดิม (เอนจินเดียวกันกับ Alert/การ์ดโดเนท) — สีต่างกันด้วย CSS filter ต่อช่อง */}
        <SmokeBackdrop textRef={figureRef} active />
        <span className="podium-rank">{String(donor.rank).padStart(2, "0")}</span>
        <span className="podium-name" title={donor.displayName}>
          {donor.displayName}
        </span>
        <span className="podium-amount">฿{donor.total.toLocaleString("th-TH")}</span>
      </div>
      <div className="podium-base" aria-hidden="true" />
    </div>
  );
}

export default function PodiumClient({ token, initial }: PodiumClientProps) {
  const [donors, setDonors] = useState<TopDonor[]>(initial?.donors ?? []);
  const [mode, setMode] = useState<TopDonorsResult["mode"]>(initial?.mode ?? "live");
  const [generatedAt, setGeneratedAt] = useState<string>(initial?.generatedAt ?? "");
  const [status, setStatus] = useState<"idle" | "live" | "offline">("idle");
  const [lastAlert, setLastAlert] = useState("—");
  const signatureRef = useRef<string>(JSON.stringify(initial?.donors ?? []));

  // อ่านค่าปรับจาก URL ระหว่าง render (client snapshot) — ฝั่ง server ใช้ค่า default ที่ตรงกับค่าเริ่มต้นจริง
  // ทำให้ SSR มีแถว Podium ตั้งแต่เฟรมแรก (ไม่ต้องรอ hydrate) และไม่มี hydration mismatch
  const urlConfig = useSyncExternalStore(subscribeToConfig, getClientPodiumConfig, getServerPodiumConfig);
  const config = urlConfig ?? DEFAULT_CONFIG;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const query = new URLSearchParams({ token, limit: "3" });
      if (config.includeTest) query.set("includeTest", "1");

      const response = await fetch(`/api/overlay/top-donors?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        setStatus("offline");
        return;
      }

      const data = (await response.json()) as TopDonorsResult;
      const signature = JSON.stringify(data.donors);

      // อัปเดตเฉพาะเมื่อข้อมูลเปลี่ยนจริง → ไม่ re-render ซ้ำ (ไม่กระพริบตอนสลับกลับมา)
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setDonors(data.donors);
      }

      setMode(data.mode);
      setGeneratedAt(data.generatedAt);
      setStatus("live");
    } catch {
      setStatus("offline");
    }
  }, [config, token]);

  // real-time ด้วย SSE เดิม (role=passive) — มีโดเนทใหม่ = refetch ทันที ไม่ต้อง refresh หน้า
  useEffect(() => {
    const source = new EventSource(`/api/alerts/stream?token=${encodeURIComponent(token)}&role=passive`);
    let debounce: ReturnType<typeof setTimeout> | null = null;

    source.addEventListener("alert", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { donorName?: string; amount?: number };
        setLastAlert(`${payload.donorName ?? "?"} · ฿${payload.amount ?? 0}`);
      } catch {
        // payload เพี้ยน — ข้าม
      }

      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void refresh();
      }, 350);
    });

    source.onopen = () => {
      setStatus((current) => (current === "offline" ? "live" : current));
      // sync ข้อมูลทุกครั้งที่เชื่อมต่อ (รวมครั้งแรกหลัง mount) — ทำใน callback ของ SSE
      // แทนการเรียกใน effect body เพื่อไม่ให้เกิด cascading render ตอน mount
      void refresh();
    };
    source.onerror = () => setStatus("offline");

    return () => {
      if (debounce) clearTimeout(debounce);
      source.close();
    };
  }, [config, refresh, token]);

  const scale = config.scale * (config.widthPx > 0 ? config.widthPx / REFERENCE_WIDTH_PX : 1);

  const rootStyle: CSSProperties = {
    "--podium-w": config.widthPx > 0 ? `${config.widthPx}px` : `calc(min(28vw, 460px) * ${LATEST_SCALE})`,
    "--podium-pad-x": config.padPx > 0 ? `${config.padPx}px` : "3.2vw",
    "--podium-pad-y": config.padPx > 0 ? `${config.padPx}px` : "5.5vh",
    "--podium-scale": String(scale),
  } as CSSProperties;

  const hasData = donors.length > 0;
  const byRank = (rank: number): TopDonor | null => donors.find((donor) => donor.rank === rank) ?? null;

  return (
    <div className="podium-root" data-pos={config.position} data-mode={mode} data-empty={hasData ? "0" : "1"} style={rootStyle}>
      {hasData ? (
        <div className="podium-row">
          {/* ลำดับใน DOM = 2, 1, 3 เพื่อให้ "01 อยู่กลาง" ตามสเปก (ช่องไหนไม่มีข้อมูล = เว้นว่าง) */}
          <PodiumSlot donor={byRank(2)} tint={config.tints[2]} variant="side" />
          <PodiumSlot donor={byRank(1)} tint={config.tints[1]} variant="center" />
          <PodiumSlot donor={byRank(3)} tint={config.tints[3]} variant="side" />
        </div>
      ) : null}

      {config.diag ? (
        <pre className="podium-diag">
          {[
            `mode=${mode}${config.includeTest ? " (includeTest=1 — dev เท่านั้น)" : " (live only — ยอดจริง)"}`,
            `sse=${status} · lastAlert=${lastAlert}`,
            `generatedAt=${generatedAt || "—"}`,
            `pos=${config.position} · width=${config.widthPx > 0 ? `${config.widthPx}px` : "auto"} · pad=${config.padPx > 0 ? `${config.padPx}px` : "auto"} · scale=${scale.toFixed(2)}`,
            `tint1/2/3 = ${config.tints[1]} | ${config.tints[2]} | ${config.tints[3]}`,
            `donors = ${donors.map((d) => `${d.rank}:${d.displayName}=฿${d.total}${d.anonymous ? " (anon)" : ""}`).join(" · ") || "—"}`,
            "จูนควัน: ?smoke=A2&smokespreadx=1.1&smokespready=1&smokefit=1 (พารามิเตอร์ชุดเดียวกับหน้า /overlay)",
          ].join("\n")}
        </pre>
      ) : null}

      <style>{PODIUM_CSS}</style>
    </div>
  );
}

/**
 * CSS ของ Podium — คัดภาษาเดิมของการ์ด Last Follow/Goal
 * (frosted glass token · --ink · สเกลตัวอักษรแบบ clamp · เงาข้อความสไตล์เดียวกับที่ใช้บนจอ)
 */
const PODIUM_CSS = `
  .podium-root {
    position: fixed;
    z-index: 5;
    width: var(--podium-w, calc(min(28vw, 460px) * 0.82));
    --ink: #eef1f6;
    color: var(--ink);
    font-family: "Montserrat", "Noto Sans Thai", "Leelawadee UI", "Segoe UI", Tahoma, sans-serif;
    pointer-events: none;
  }
  .podium-root[data-pos="bottom-left"] { left: var(--podium-pad-x, 3.2vw); bottom: var(--podium-pad-y, 5.5vh); }
  .podium-root[data-pos="bottom-right"] { right: var(--podium-pad-x, 3.2vw); bottom: var(--podium-pad-y, 5.5vh); }
  .podium-root[data-pos="top-left"] { left: var(--podium-pad-x, 3.2vw); top: var(--podium-pad-y, 5.5vh); }
  .podium-root[data-pos="top-right"] { right: var(--podium-pad-x, 3.2vw); top: var(--podium-pad-y, 5.5vh); }

  .podium-row {
    display: grid;
    grid-template-columns: 1fr 1.34fr 1fr;
    align-items: end;
    gap: calc(7px * var(--podium-scale, 1));
  }

  /* ช่องที่ยังไม่มีอันดับ → เว้นว่างสนิท แต่คง track ไว้ (ตำแหน่ง 01 กลางไม่ขยับ) */
  .podium-slot[data-empty="1"] { visibility: hidden; }
  .podium-slot { display: flex; flex-direction: column; align-items: center; min-width: 0; }

  .podium-figure {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-width: 0;
    text-align: center;
  }

  /* ควัน: ย้อมสีเฉพาะช่องด้วย CSS filter (ไม่แตะงานศิลป์/แอนิเมชันของเอนจินเดิม) */
  .podium-slot .oa-smoke { filter: var(--slot-tint, none); }

  .podium-rank,
  .podium-name,
  .podium-amount { position: relative; z-index: 1; }

  .podium-rank {
    font-size: calc(clamp(15px, 1.35vw, 22px) * var(--podium-scale, 1));
    font-weight: 600;
    letter-spacing: 0.16em;
    line-height: 1;
    opacity: 0.5;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
  }
  .podium-slot[data-variant="center"] .podium-rank { opacity: 0.78; }

  .podium-name {
    margin-top: calc(5px * var(--podium-scale, 1));
    max-width: 100%;
    font-size: calc(clamp(11px, 0.95vw, 15px) * var(--podium-scale, 1));
    font-weight: 500;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.88), 0 0 22px rgba(0, 0, 0, 0.5);
  }
  .podium-slot[data-variant="center"] .podium-name {
    font-size: calc(clamp(12px, 1.05vw, 17px) * var(--podium-scale, 1));
  }

  .podium-amount {
    margin-top: calc(2px * var(--podium-scale, 1));
    font-size: calc(clamp(14px, 1.2vw, 20px) * var(--podium-scale, 1));
    font-weight: 700;
    color: #ffd76a;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92), 0 0 24px rgba(0, 0, 0, 0.55);
  }
  .podium-slot[data-variant="center"] .podium-amount {
    font-size: calc(clamp(16px, 1.45vw, 25px) * var(--podium-scale, 1));
  }

  /* แท่น: frosted glass token เดิม (gradient เดียวกัน + hairline ring เดียวกัน) */
  .podium-base {
    width: 100%;
    margin-top: calc(7px * var(--podium-scale, 1));
    height: calc(58px * var(--podium-scale, 1));
    border-radius: calc(6px * var(--podium-scale, 1));
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.02) 50%, rgba(255, 255, 255, 0.045));
    -webkit-backdrop-filter: blur(7px) saturate(1.05);
    backdrop-filter: blur(7px) saturate(1.05);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  .podium-slot[data-variant="center"] .podium-base { height: calc(96px * var(--podium-scale, 1)); }

  /* แผงวินิจฉัย (?podiumdiag=1) */
  .podium-diag {
    position: fixed;
    left: 8px;
    bottom: 8px;
    max-width: 620px;
    margin: 0;
    padding: 8px;
    white-space: pre-wrap;
    font: 11px/1.35 ui-monospace, Consolas, "Cascadia Mono", monospace;
    color: #bae6fd;
    background: rgba(0, 0, 0, 0.75);
    border-radius: 6px;
    z-index: 9999;
  }
`;

