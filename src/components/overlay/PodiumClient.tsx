"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import SmokeBackdrop from "./SmokeBackdrop";
import type { TopDonor, TopDonorsResult } from "@/lib/top-donors";

/**
 * Top Donate — ผู้สนับสนุนยอดสะสมสูงสุด 3 อันดับ (ดีไซน์ "ตารางไม่มีกรอบ")
 *
 * ดีไซน์: ให้ความรู้สึกเดียวกับการ์ด Last Follow — ตัวหนังสือใหญ่ อ่านง่าย ไม่มีแท่น/ไม่มีกรอบ/ไม่มีเส้นคั่น
 *  01 · ชื่อผู้สนับสนุน · ฿ยอดรวม     ← หนึ่งบรรทัดต่อหนึ่งคน (เรียงยอดมาก → น้อย)
 *  - เลขอันดับเป็น typography (01/02/03) สื่อลำดับด้วย "สี" ของตัวเลข (ทอง/เงิน/ทองแดง) ไม่ใช้ emoji
 *  - ควัน = เอนจินเดิมของระบบ (SmokeBackdrop) ครอบทั้งชุดเป็นก้อนเดียว (ไม่ใช่ต่อช่องแบบโพเดียม)
 *  - ตัวหนังสือใช้เงานุ่มแบบเดียวกับที่ใช้บนจอ (ไม่ต้องมี plate ก็อ่านชัด) · ใส่ plate จาง ๆ ได้ด้วย ?plate=1
 *
 * กติกาข้อมูล: นับเฉพาะยอดจริง (ดู src/lib/top-donors.ts) · 匿名 → "ไม่ระบุชื่อ"
 * ถ้ามีไม่ถึง 3 คน = แสดงเท่าที่มี (ไม่สร้างข้อมูลปลอม) · ไม่มีเลย = ไม่แสดงอะไร (โปร่งใส)
 */

interface PodiumClientProps {
  token: string;
  /** ข้อมูลชุดแรกจาก server (SSR) — เปิดหน้าแล้วเห็นทันที ไม่ต้องรอ fetch */
  initial: TopDonorsResult | null;
}

type BoardPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";

interface BoardConfig {
  position: BoardPosition;
  /** >0 = ปักความกว้างเป็น px (เหมือน ?latestwidthpx= ของระบบเดิม) */
  widthPx: number;
  /** >0 = ปักระยะห่างจากขอบเป็น px (เหมือน ?latestpadpx=) */
  padPx: number;
  scale: number;
  /** สีควันของทั้งชุด (CSS filter) — "none" = ไม่ย้อม */
  tint: string;
  /** true = ใส่พื้นฝ้า (frosted) จาง ๆ หลังข้อความทั้งชุด (ไม่มีเส้นขอบ) */
  plate: boolean;
  /** false = ไม่ต้องมีควันเลย */
  smoke: boolean;
  /** true = เลขอันดับ 01/02/03 ได้สี ทอง/เงิน/ทองแดง */
  rankColor: boolean;
  /** true = ใช้กับ dev เท่านั้น (นับยอดทดสอบด้วย) */
  includeTest: boolean;
  diag: boolean;
}

/** สีควันเริ่มต้น: โทนทองอ่อน ๆ (เข้าชุดกับเลข 01 และสีตัวเลขยอดเงิน) */
const DEFAULT_TINT = "sepia(.86) saturate(2.7) hue-rotate(-10deg) brightness(1.06)";

/**
 * ความกว้างเริ่มต้น: กว้างกว่าการ์ด Last Follow เล็กน้อย เพื่อให้ชื่อ + ยอดตัวใหญ่ยังอ่านครบ
 * (การ์ด Last Follow = calc(min(28vw,460px) * .82) ≈ 380px @1920)
 */
const BOARD_WIDTH_CSS = "calc(min(32vw, 560px) * 0.92)";
const REFERENCE_WIDTH_PX = 515;

const POSITIONS: readonly BoardPosition[] = ["bottom-left", "bottom-right", "top-left", "top-right"];

function readNum(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** อ่านค่าปรับจาก URL (รองรับชื่อพารามิเตอร์ของการ์ดเดิมด้วย เช่น latestwidthpx) */
function readBoardConfig(search: string): BoardConfig {
  const params = new URLSearchParams(search);
  const posRaw = (params.get("podiumposition") ?? params.get("latestposition") ?? "bottom-left").toLowerCase();
  const position = (POSITIONS as readonly string[]).includes(posRaw) ? (posRaw as BoardPosition) : "bottom-left";

  const widthPx = Math.round(readNum(params, "podiumwidthpx", readNum(params, "latestwidthpx", 0)));
  const padPx = Math.round(readNum(params, "podiumpadpx", readNum(params, "latestpadpx", 0)));

  const scaleRaw = Number(params.get("podiumscale"));
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0.2 && scaleRaw <= 3 ? scaleRaw : 1;

  const rawTint = (params.get("tint") ?? "").trim();

  return {
    position,
    widthPx,
    padPx,
    scale,
    tint: rawTint === "" ? DEFAULT_TINT : rawTint.toLowerCase() === "none" || rawTint === "0" ? "none" : rawTint,
    plate: params.get("plate") === "1",
    smoke: params.get("nosmoke") !== "1",
    rankColor: params.get("rankcolor") !== "0",
    includeTest: params.get("includetest") === "1" || params.get("includeTest") === "1",
    diag: params.get("podiumdiag") === "1",
  };
}

/**
 * ค่าเริ่มต้น — ใช้เมื่อ "ยังไม่รู้ URL ของเบราว์เซอร์" (ตอน SSR/เฟรมแรก)
 * ค่าตรงกับค่าเริ่มต้นจริง: มุมล่างซ้าย · ความกว้างตามสูตร · ควันทองอ่อน · ไม่มี plate
 */
const DEFAULT_CONFIG: BoardConfig = {
  position: "bottom-left",
  widthPx: 0,
  padPx: 0,
  scale: 1,
  tint: DEFAULT_TINT,
  plate: false,
  smoke: true,
  rankColor: true,
  includeTest: false,
  diag: false,
};

/* ------------------------------------------------------------------
 * อ่านค่าปรับจาก URL ระหว่าง render ด้วย useSyncExternalStore
 * (ไม่ใช้ setState ใน effect → ไม่มี cascading render และไม่ hydration mismatch)
 * ------------------------------------------------------------------ */

/** URL ของหน้านิ่งตลอดอายุหน้า → ไม่มีอะไรต้อง subscribe */
function subscribeToConfig(): () => void {
  return () => {};
}

/** cache ระดับโมดูล: getSnapshot ต้องคืนค่าเดิมเมื่อค่าไม่เปลี่ยน (กัน React เตือน/loop) */
let cachedSearch: string | null = null;
let cachedConfig: BoardConfig | null = null;

function getClientBoardConfig(): BoardConfig | null {
  if (typeof window === "undefined") return null;

  const search = window.location.search;
  if (cachedSearch !== search || !cachedConfig) {
    cachedSearch = search;
    cachedConfig = readBoardConfig(search);
  }

  return cachedConfig;
}

/** ฝั่ง server ไม่มี URL ของเบราว์เซอร์ → คืน null แล้วใช้ DEFAULT_CONFIG (HTML ที่ SSR ตรงกับ client) */
function getServerBoardConfig(): BoardConfig | null {
  return null;
}

export default function PodiumClient({ token, initial }: PodiumClientProps) {
  const [donors, setDonors] = useState<TopDonor[]>(initial?.donors ?? []);
  const [mode, setMode] = useState<TopDonorsResult["mode"]>(initial?.mode ?? "live");
  const [generatedAt, setGeneratedAt] = useState<string>(initial?.generatedAt ?? "");
  const [status, setStatus] = useState<"idle" | "live" | "offline">("idle");
  const [lastAlert, setLastAlert] = useState("—");
  const [refreshedAt, setRefreshedAt] = useState("—");
  const listRef = useRef<HTMLDivElement | null>(null);
  const signatureRef = useRef<string>(JSON.stringify(initial?.donors ?? []));

  const urlConfig = useSyncExternalStore(subscribeToConfig, getClientBoardConfig, getServerBoardConfig);
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
      setRefreshedAt(new Date().toLocaleTimeString("th-TH"));
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
    "--board-w": config.widthPx > 0 ? `${config.widthPx}px` : BOARD_WIDTH_CSS,
    "--board-pad-x": config.padPx > 0 ? `${config.padPx}px` : "3.2vw",
    "--board-pad-y": config.padPx > 0 ? `${config.padPx}px` : "5.5vh",
    "--board-scale": String(scale),
    "--board-tint": config.tint,
  } as CSSProperties;

  const hasData = donors.length > 0;

  return (
    <div
      className="board-root"
      data-pos={config.position}
      data-mode={mode}
      data-empty={hasData ? "0" : "1"}
      data-rankcolor={config.rankColor ? "1" : "0"}
      style={rootStyle}
    >
      {hasData ? (
        <div className="board-list" data-plate={config.plate ? "1" : "0"} ref={listRef}>
          {/* ควันชุดเดิมของระบบ (ก้อนเดียวครอบทั้งตาราง) — ปิดได้ด้วย ?nosmoke=1 */}
          {config.smoke ? <SmokeBackdrop textRef={listRef} active /> : null}

          {donors.map((donor) => (
            <div className="board-row" data-rank={donor.rank} key={donor.rank}>
              <span className="board-rank">{String(donor.rank).padStart(2, "0")}</span>
              <span className="board-name" title={donor.displayName}>
                {donor.displayName}
              </span>
              <span className="board-amount">฿{donor.total.toLocaleString("th-TH")}</span>
            </div>
          ))}
        </div>
      ) : null}

      {config.diag ? (
        <pre className="board-diag">
          {[
            `mode=${mode}${config.includeTest ? " (includeTest=1 — dev เท่านั้น)" : " (live only — ยอดจริง)"}`,
            `sse=${status} · lastAlert=${lastAlert} · refreshed=${refreshedAt}`,
            `generatedAt=${generatedAt || "—"}`,
            `pos=${config.position} · width=${config.widthPx > 0 ? `${config.widthPx}px` : "auto"} · scale=${scale.toFixed(2)}`,
            `plate=${config.plate ? "1" : "0"} · smoke=${config.smoke ? "1" : "0"} · rankcolor=${config.rankColor ? "1" : "0"} · tint=${config.tint}`,
            `donors = ${donors.map((d) => `${d.rank}:${d.displayName}=฿${d.total}${d.anonymous ? " (anon)" : ""}`).join(" · ") || "—"}`,
          ].join("\n")}
        </pre>
      ) : null}

      <style>{BOARD_CSS}</style>
    </div>
  );
}

/**
 * CSS ของ "ตารางไม่มีกรอบ" — อ่านง่าย ตัวใหญ่เหมือนการ์ด Last Follow
 * ไม่มีกรอบ/ไม่มีเส้นคั่น/ไม่มีแท่น · เงาข้อความแบบเดียวกับที่ใช้บนจอ
 */
const BOARD_CSS = `
  .board-root {
    position: fixed;
    z-index: 5;
    width: var(--board-w, calc(min(32vw, 560px) * 0.92));
    --ink: #eef1f6;
    color: var(--ink);
    font-family: "Montserrat", "Noto Sans Thai", "Leelawadee UI", "Segoe UI", Tahoma, sans-serif;
    pointer-events: none;
  }
  .board-root[data-pos="bottom-left"] { left: var(--board-pad-x, 3.2vw); bottom: var(--board-pad-y, 5.5vh); }
  .board-root[data-pos="bottom-right"] { right: var(--board-pad-x, 3.2vw); bottom: var(--board-pad-y, 5.5vh); }
  .board-root[data-pos="top-left"] { left: var(--board-pad-x, 3.2vw); top: var(--board-pad-y, 5.5vh); }
  .board-root[data-pos="top-right"] { right: var(--board-pad-x, 3.2vw); top: var(--board-pad-y, 5.5vh); }

  .board-list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: calc(6px * var(--board-scale, 1));
  }

  /* พื้นฝ้าจาง ๆ (ไม่บังคับ — ?plate=1) ไม่มีเส้นขอบตามที่กำหนด */
  .board-list[data-plate="1"] {
    padding: calc(14px * var(--board-scale, 1)) calc(18px * var(--board-scale, 1));
    border-radius: calc(10px * var(--board-scale, 1));
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.02) 50%, rgba(255, 255, 255, 0.045));
    -webkit-backdrop-filter: blur(7px) saturate(1.05);
    backdrop-filter: blur(7px) saturate(1.05);
  }

  /* ควัน: ย้อมสีทั้งก้อนด้วย CSS filter (ไม่แตะงานศิลป์/แอนิเมชันของเอนจินเดิม) */
  .board-list .oa-smoke { filter: var(--board-tint, none); }

  /* หนึ่งบรรทัด = อันดับ | ชื่อ | ยอด (ไม่มีเส้นคั่น/ไม่มีกรอบ) */
  .board-row {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    column-gap: clamp(10px, 1vw, 18px);
  }

  .board-rank {
    font-size: calc(clamp(19px, 2vw, 30px) * var(--board-scale, 1));
    font-weight: 600;
    letter-spacing: 0.06em;
    color: #f2f5fa;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9), 0 0 22px rgba(0, 0, 0, 0.5);
  }

  /* สีสื่ออันดับ (ไม่เขียนคำ Gold/Silver/Bronze) — ปิดได้ด้วย ?rankcolor=0 */
  .board-root[data-rankcolor="1"] .board-row[data-rank="1"] .board-rank { color: #ffd76a; }
  .board-root[data-rankcolor="1"] .board-row[data-rank="2"] .board-rank { color: #dbe2ee; }
  .board-root[data-rankcolor="1"] .board-row[data-rank="3"] .board-rank { color: #e6a978; }

  .board-name {
    font-size: calc(clamp(23px, 2.6vw, 40px) * var(--board-scale, 1));
    font-weight: 600;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 3px 10px rgba(0, 0, 0, 0.92), 0 0 26px rgba(0, 0, 0, 0.55);
  }

  .board-amount {
    font-size: calc(clamp(23px, 2.6vw, 40px) * var(--board-scale, 1));
    font-weight: 700;
    color: #ffd76a;
    text-shadow: 0 3px 10px rgba(0, 0, 0, 0.95), 0 0 26px rgba(0, 0, 0, 0.55);
  }

  .board-diag {
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

