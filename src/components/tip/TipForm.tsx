"use client";

import { useMemo, useState } from "react";
import { getProviderMinimumAmount } from "@/lib/payment/limits";

/**
 * ฟอร์มโดเนท (ธีมขาว มินิมอล)
 *
 * - UI: ชื่อ → จำนวนเงิน → ข้อความ → ปุ่มจ่ายเงิน (ปุ่มเดียวในหน้า)
 * - Logic การจ่ายเงินไม่เปลี่ยน: POST /api/tips → ได้ checkoutUrl → พาไปหน้าจ่ายเงินของ Stripe
 * - Validation ทำฝั่ง client เพื่อ UX เท่านั้น (เซิร์ฟเวอร์ตรวจซ้ำเสมอใน src/app/api/tips/route.ts)
 */

/** ตัวเลือกจำนวนเงินยอดนิยม (บาท) — แสดงเฉพาะค่าที่ไม่ต่ำกว่าขั้นต่ำของระบบ */
const AMOUNT_PRESETS = [10, 20, 50, 100, 300];

/** เพดานเดียวกับที่ Server ตรวจ (src/app/api/tips/route.ts) */
const MAX_AMOUNT = 100_000;

/** พาเบราว์เซอร์ไปหน้าจ่ายเงิน (แยกเป็นฟังก์ชันนอก component — ไม่แก้ค่าภายนอกระหว่าง render) */
function redirectToCheckout(url: string): void {
  window.location.href = url;
}

/** แปลงข้อความเป็นจำนวนเงิน — คืน 0 ถ้าว่างหรือไม่ใช่ตัวเลขล้วน */
function parseAmount(input: string): number {
  const trimmed = input.trim();
  if (trimmed === "" || !/^\d+(\.\d*)?$/.test(trimmed)) return 0;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** กรองอักขระที่พิมพ์ได้ให้เหลือเฉพาะตัวเลขและจุดทศนิยม 1 จุด */
function sanitizeAmountInput(input: string): string {
  const digitsAndDots = input.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");

  return rest.length > 0 ? `${first}.${rest.join("")}` : first;
}

function formatBaht(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

interface TipFormProps {
  /** ยอดขั้นต่ำจาก DB (SystemSetting.minTipAmount) */
  minAmount: number;
  /** สกุลเงิน (ใช้แสดงผลเท่านั้น) */
  currency: string;
  /** ความยาวข้อความสูงสุดจาก DB */
  maxMessageLength: number;
}

export default function TipForm({ minAmount, currency, maxMessageLength }: TipFormProps) {
  const [donorName, setDonorName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [presetAmount, setPresetAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [isCustomAmount, setIsCustomAmount] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [error, setError] = useState("");

  const busy = isLoading || isRedirecting;

  const presets = useMemo(
    () => AMOUNT_PRESETS.filter((value) => value >= Math.max(1, minAmount)),
    [minAmount]
  );

  // ขั้นต่ำของ "ช่องทางจ่ายเงิน" (Stripe THB = 10) — ต่างจากขั้นต่ำของเว็บ (minAmount = 1)
  const channelMinAmount = getProviderMinimumAmount(currency);

  /** หน่วยท้ายปุ่มจำนวนเงิน — THB แสดงเป็น "บาท" */
  const currencySuffix = currency.toUpperCase() === "THB" ? "บาท" : currency.toUpperCase();

  const finalAmount = isCustomAmount ? parseAmount(customAmount) : (presetAmount ?? 0);

  /** ข้อความผิดพลาดของจำนวนเงิน (null = ใช้ได้) */
  const amountError = useMemo(() => {
    if (finalAmount <= 0) return "กรุณาเลือกหรือกรอกจำนวนเงิน";
    if (finalAmount < minAmount) return `ยอดขั้นต่ำคือ ฿${formatBaht(minAmount)}`;
    if (finalAmount < channelMinAmount) {
      return `ช่องทางบัตร/PromptPay เริ่มที่ ฿${formatBaht(channelMinAmount)}`;
    }
    if (finalAmount > MAX_AMOUNT) return `ยอดสูงสุดต่อครั้งคือ ฿${formatBaht(MAX_AMOUNT)}`;

    return null;
  }, [finalAmount, minAmount, channelMinAmount]);

  /** ข้อความผิดพลาดของชื่อ (null = ใช้ได้) */
  const nameError =
    !isAnonymous && donorName.trim().length === 0
      ? "กรุณากรอกชื่อ หรือเลือก “ไม่ระบุชื่อ”"
      : null;

  // แสดง error ของยอดเงินเมื่อผู้ใช้แตะช่องนี้แล้ว หรือกำลังพิมพ์จำนวนเงินเองอยู่
  const showAmountError =
    amountError !== null && (amountTouched || (isCustomAmount && customAmount.trim() !== ""));

  const showNameError = nameError !== null && nameTouched;

  const canSubmit =
    !busy && amountError === null && (isAnonymous || donorName.trim().length > 0);

  /** คำใบ้สั้น ๆ ใต้ปุ่ม ว่ายังต้องเติมอะไรก่อนจึงจะกดจ่ายได้ */
  const disabledHint = (() => {
    if (canSubmit || busy) return null;

    const missingAmount = amountError !== null && !showAmountError;
    const missingName = nameError !== null && !showNameError;

    if (missingAmount && missingName) return "กรอกชื่อและเลือกจำนวนเงินก่อนกดจ่ายเงิน";
    if (missingAmount) return "เลือกจำนวนเงินหรือระบุจำนวนเงินเองก่อนกดจ่ายเงิน";
    if (missingName) return "กรอกชื่อ หรือเลือก “ไม่ระบุชื่อ”";

    return null;
  })();

  function selectPreset(value: number): void {
    setPresetAmount(value);
    setIsCustomAmount(false);
    setCustomAmount("");
    setAmountTouched(true);
    setError("");
  }

  function selectCustomAmount(): void {
    setIsCustomAmount(true);
    setPresetAmount(null);
    setError("");
  }

  function changeCustomAmount(value: string): void {
    setCustomAmount(sanitizeAmountInput(value));
    setIsCustomAmount(true);
    setPresetAmount(null);
    setError("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setNameTouched(true);
    setAmountTouched(true);

    // ปุ่มถูก disable ไว้แล้ว — กันอีกชั้นสำหรับกรณี implicit submit (กด Enter)
    if (amountError !== null) return;
    if (!isAnonymous && donorName.trim().length === 0) return;

    setIsLoading(true);

    try {
      const res = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: isAnonymous ? undefined : donorName.trim(),
          isAnonymous,
          amount: finalAmount,
          message: message.trim() || undefined,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        checkoutUrl?: string;
      };

      if (!res.ok) {
        if (res.status === 429) {
          setError("ส่งรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
        } else if (res.status === 422) {
          // ถ้า server ส่งข้อความไทยมาแล้ว (เช่น ยอดต่ำกว่าขั้นต่ำของ Stripe) ให้แสดงข้อความนั้นตรง ๆ
          setError(
            data.error && /[\u0E00-\u0E7F]/.test(data.error)
              ? data.error
              : `ข้อมูลไม่ถูกต้อง — ขั้นต่ำ ฿${formatBaht(minAmount)} (บัตร/PromptPay เริ่ม ฿${formatBaht(channelMinAmount)})`
          );
        } else {
          setError(data.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        }

        return;
      }

      if (!data.checkoutUrl) {
        setError("ไม่ได้รับลิงก์ชำระเงิน กรุณาลองใหม่");
        return;
      }

      // สำเร็จ — แสดงสถานะสั้น ๆ แล้วพาไปหน้าจ่ายเงินของ Stripe (บัตร/PromptPay)
      setIsRedirecting(true);
      redirectToCheckout(data.checkoutUrl);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      {/* ---------- 1) ชื่อ ---------- */}
      <div>
        <label htmlFor="donor-name" className="block text-sm font-semibold text-ink">
          ชื่อ
        </label>

        <input
          id="donor-name"
          name="donorName"
          type="text"
          autoComplete="nickname"
          maxLength={50}
          value={donorName}
          onChange={(event) => {
            setDonorName(event.target.value);
            setError("");
          }}
          onBlur={() => setNameTouched(true)}
          disabled={isAnonymous || busy}
          placeholder="กรอกชื่อของคุณ"
          aria-invalid={showNameError}
          aria-describedby={showNameError ? "donor-name-error" : undefined}
          className="field-input mt-2 h-12 rounded-[10px] px-4"
        />

        {showNameError ? (
          <p id="donor-name-error" className="mt-2 text-[13px] leading-relaxed text-danger">
            {nameError}
          </p>
        ) : null}

        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5 select-none">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(event) => {
              setIsAnonymous(event.target.checked);
              setNameTouched(false);
              setError("");
            }}
            disabled={busy}
            className="h-[18px] w-[18px] shrink-0 rounded-[5px] accent-[var(--color-accent)]"
          />
          <span className="text-sm text-ink">ไม่ระบุชื่อ</span>
        </label>

        {isAnonymous ? (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            จะแสดงเป็น “ผู้ไม่ประสงค์ออกนาม”
          </p>
        ) : null}
      </div>

      {/* ---------- 2) จำนวนเงิน ---------- */}
      <fieldset>
        <legend className="text-sm font-semibold text-ink">จำนวนเงิน</legend>

        <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              aria-pressed={!isCustomAmount && presetAmount === preset}
              disabled={busy}
              className="amount-chip h-12 rounded-[10px] text-[15px] font-medium"
            >
              {preset.toLocaleString("th-TH")} {currencySuffix}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={selectCustomAmount}
          aria-pressed={isCustomAmount}
          disabled={busy}
          className="amount-chip mt-2.5 h-12 w-full rounded-[10px] text-[15px] font-medium"
        >
          ระบุจำนวนเงินเอง
        </button>

        {isCustomAmount ? (
          <div className="relative mt-2.5">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] text-ink-soft"
            >
              ฿
            </span>
            <input
              id="custom-amount"
              name="customAmount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={customAmount}
              onChange={(event) => changeCustomAmount(event.target.value)}
              onBlur={() => setAmountTouched(true)}
              disabled={busy}
              placeholder="กรอกจำนวนเงิน"
              aria-label="จำนวนเงินที่ต้องการสนับสนุน (บาท)"
              aria-invalid={showAmountError}
              aria-describedby={showAmountError ? "amount-error" : undefined}
              className="field-input h-12 rounded-[10px] pr-4 pl-9"
            />
          </div>
        ) : null}

        {showAmountError ? (
          <p id="amount-error" className="mt-2 text-[13px] leading-relaxed text-danger">
            {amountError}
          </p>
        ) : null}
      </fieldset>

      {/* ---------- 3) ข้อความ ---------- */}
      <div>
        <label htmlFor="tip-message" className="block text-sm font-semibold text-ink">
          ข้อความ
        </label>

        <textarea
          id="tip-message"
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={busy}
          maxLength={maxMessageLength}
          rows={3}
          placeholder="เขียนข้อความที่ต้องการให้ระบบอ่าน"
          aria-describedby="tip-message-help tip-message-count"
          className="field-input mt-2 resize-none rounded-[10px] px-4 py-3"
        />

        <div className="mt-2 flex items-start justify-between gap-3">
          <p id="tip-message-help" className="text-[13px] leading-relaxed text-ink-soft">
            ข้อความนี้จะถูกนำไปอ่านโดยระบบ
          </p>
          <p id="tip-message-count" className="shrink-0 text-[13px] tabular-nums text-ink-faint">
            {message.length}/{maxMessageLength}
          </p>
        </div>
      </div>

      {/* ---------- 4) ปุ่มจ่ายเงิน (ปุ่มเดียวในหน้า) ---------- */}
      <div>
        {error ? (
          <p
            role="alert"
            aria-live="polite"
            className="mb-4 rounded-[10px] border border-danger-line bg-danger-tint px-4 py-3 text-[13px] leading-relaxed text-danger"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={busy}
          className={`pay-btn flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] text-[16px] font-semibold ${
            busy ? "bg-accent text-white" : ""
          }`}
        >
          {busy ? (
            <>
              <span
                aria-hidden="true"
                className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
              />
              กำลังดำเนินการ...
            </>
          ) : (
            "จ่ายเงิน"
          )}
        </button>

        {disabledHint ? (
          <p className="mt-3 text-center text-[13px] leading-relaxed text-ink-soft">{disabledHint}</p>
        ) : null}

        <p role="status" aria-live="polite" className="sr-only">
          {isRedirecting ? "กำลังพาคุณไปหน้าจ่ายเงิน" : ""}
        </p>

        <p className="mt-3 text-center text-[13px] leading-relaxed text-ink-faint">
          ชำระเงินปลอดภัยผ่าน Stripe · ไม่เก็บข้อมูลบัตรของคุณ
        </p>
      </div>
    </form>
  );
}
