"use client";

import { useMemo, useState } from "react";
import { getProviderMinimumAmount } from "@/lib/payment/limits";

/** ตัวเลือกจำนวนเงินยอดนิยม (บาท) — แสดงเฉพาะค่าที่ไม่ต่ำกว่าขั้นต่ำของระบบ */
const AMOUNT_PRESETS = [10, 20, 50, 100, 300];

/** เพดานเดียวกับที่ Server ตรวจ (src/app/api/tips/route.ts) */
const MAX_AMOUNT = 100_000;

/** พาเบราว์เซอร์ไปหน้าจ่ายเงิน (แยกเป็นฟังก์ชันนอก component — ไม่แก้ค่าภายนอกระหว่าง render) */
function redirectToCheckout(url: string): void {
  window.location.href = url;
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
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const presets = useMemo(
    () => AMOUNT_PRESETS.filter((value) => value >= Math.max(1, minAmount)),
    [minAmount]
  );

  // ขั้นต่ำของ "ช่องทางจ่ายเงิน" (Stripe THB = 10) — ต่างจากขั้นต่ำของเว็บ (minAmount = 1)
  const channelMinAmount = getProviderMinimumAmount(currency);

  const parsedCustom = Number(customAmount);
  const finalAmount = presetAmount ?? (customAmount !== "" && Number.isFinite(parsedCustom) ? parsedCustom : 0);

  function selectPreset(value: number): void {
    setPresetAmount(value);
    setCustomAmount("");
    setError("");
  }

  function changeCustomAmount(value: string): void {
    setCustomAmount(value);
    setPresetAmount(null);
    setError("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");

    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      setError("กรุณาเลือกหรือกรอกจำนวนเงิน");
      return;
    }

    if (finalAmount < minAmount) {
      setError(`ยอดขั้นต่ำคือ ฿${minAmount.toLocaleString("th-TH")}`);
      return;
    }

    if (finalAmount < channelMinAmount) {
      setError(
        `ช่องทางบัตร/PromptPay เริ่มที่ ฿${channelMinAmount.toLocaleString("th-TH")} — ยอดต่ำกว่านี้ต้องโอนตรงด้วย PromptPay QR (ยังไม่เปิดใช้งาน)`
      );
      return;
    }

    if (finalAmount > MAX_AMOUNT) {
      setError(`ยอดสูงสุดต่อครั้งคือ ฿${MAX_AMOUNT.toLocaleString("th-TH")}`);
      return;
    }

    if (!isAnonymous && donorName.trim().length === 0) {
      setError("กรุณากรอกชื่อที่จะแสดงบนสตรีม หรือเลือกไม่ประสงค์ออกนาม");
      return;
    }

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
              : `ข้อมูลไม่ถูกต้อง — ขั้นต่ำ ฿${minAmount.toLocaleString("th-TH")} (บัตร/PromptPay เริ่ม ฿${channelMinAmount.toLocaleString("th-TH")})`
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

      // ไปหน้าจ่ายเงินของ Stripe (บัตร/PromptPay) — ปลอดภัย ไม่เก็บข้อมูลบัตรที่เว็บเรา
      redirectToCheckout(data.checkoutUrl);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* ---------- ชื่อผู้สนับสนุน ---------- */}
      <div className="space-y-2">
        <label htmlFor="donor-name" className="block text-sm font-medium text-white/85">
          ชื่อที่จะแสดงบนสตรีม <span className="text-white/45">(สูงสุด 50 ตัวอักษร)</span>
        </label>
        <input
          id="donor-name"
          name="donorName"
          type="text"
          autoComplete="nickname"
          value={donorName}
          onChange={(event) => setDonorName(event.target.value)}
          disabled={isAnonymous || isLoading}
          maxLength={50}
          placeholder="เช่น คุณผู้ชมสายควัน"
          aria-describedby="donor-name-help"
          className="smoke-input w-full rounded-xl px-4 py-3 text-base text-white placeholder:text-white/40"
        />
        <p id="donor-name-help" className="text-xs text-white/50">
          ชื่อนี้จะขึ้นบนสตรีมพร้อมข้อความของคุณ
        </p>

        <label className="flex w-fit cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(event) => setIsAnonymous(event.target.checked)}
            disabled={isLoading}
            className="h-4 w-4 rounded border-white/30 bg-black/40 accent-violet-500"
          />
          <span className="text-sm text-white/75">ไม่ประสงค์ออกนาม (ซ่อนชื่อ)</span>
        </label>
      </div>

      <div className="smoke-divider" aria-hidden="true" />

      {/* ---------- จำนวนเงิน ---------- */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-white/85">
          เลือกจำนวนเงิน{" "}
          <span className="text-white/45">
            (ขั้นต่ำ ฿{minAmount.toLocaleString("th-TH")} · บัตร/PromptPay เริ่ม ฿
            {channelMinAmount.toLocaleString("th-TH")})
          </span>
        </legend>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {presets.map((preset) => {
            const isActive = presetAmount === preset;

            return (
              <button
                key={preset}
                type="button"
                onClick={() => selectPreset(preset)}
                aria-pressed={isActive}
                disabled={isLoading}
                className="smoke-chip rounded-xl border border-white/12 bg-white/[0.04] px-2 py-3 text-sm font-semibold text-white/90 disabled:opacity-60"
              >
                ฿{preset.toLocaleString("th-TH")}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <label htmlFor="custom-amount" className="block text-sm text-white/70">
            หรือระบุจำนวนเอง ({currency})
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/45"
            >
              ฿
            </span>
            <input
              id="custom-amount"
              name="customAmount"
              type="number"
              inputMode="decimal"
              min={Math.max(1, minAmount)}
              max={MAX_AMOUNT}
              step="1"
              value={customAmount}
              onChange={(event) => changeCustomAmount(event.target.value)}
              disabled={isLoading}
              placeholder={`ขั้นต่ำ ${minAmount}`}
              className="smoke-input w-full rounded-xl py-3 pl-9 pr-4 text-base text-white placeholder:text-white/35"
            />
          </div>
        </div>
      </fieldset>

      <div className="smoke-divider" aria-hidden="true" />

      {/* ---------- ช่องทางชำระเงิน ---------- */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-white/85">ช่องทางชำระเงิน</legend>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-300/45 bg-violet-400/10 p-3">
          <input
            type="radio"
            name="paymentMethod"
            value="stripe"
            defaultChecked
            disabled={isLoading}
            className="mt-1 h-4 w-4 accent-violet-500"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-white">
              บัตรเครดิต / เดบิต · PromptPay (ผ่าน Stripe)
            </span>
            <span className="block text-xs text-white/60">
              ชำระบนหน้าของ Stripe — ไม่เก็บข้อมูลบัตรที่เว็บนี้ · ขึ้นจอบนสตรีมทันทีหลังจ่ายสำเร็จ
            </span>
          </span>
        </label>

        <label
          aria-disabled="true"
          title="ยังไม่เปิดใช้งาน — ต้องตั้งค่า QR/PromptPay ของสตรีมเมอร์ก่อน"
          className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-white/10 bg-black/25 p-3 opacity-70"
        >
          <input type="radio" name="paymentMethod" value="direct" disabled className="mt-1 h-4 w-4" />
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-white/85">
              โอนตรงด้วย PromptPay QR{" "}
              <span className="ml-1 rounded-full border border-amber-300/35 bg-amber-300/15 px-2 py-0.5 text-[11px] font-medium text-amber-100">
                ยังไม่เปิดใช้งาน
              </span>
            </span>
            <span className="block text-xs text-white/55">
              ดูรายละเอียด/ตั้งค่าได้ที่หัวข้อ “โอนตรงด้วย PromptPay QR” ด้านล่าง
            </span>
          </span>
        </label>
      </fieldset>

      <div className="smoke-divider" aria-hidden="true" />

      {/* ---------- ข้อความ ---------- */}
      <div className="space-y-2">
        <label htmlFor="tip-message" className="block text-sm font-medium text-white/85">
          ข้อความถึงสตรีมเมอร์ <span className="text-white/45">(ไม่บังคับ)</span>
        </label>
        <textarea
          id="tip-message"
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={isLoading}
          maxLength={maxMessageLength}
          rows={3}
          placeholder="พิมพ์ข้อความสั้น ๆ ที่อยากให้ขึ้นจอ..."
          aria-describedby="tip-message-count"
          className="smoke-input w-full resize-none rounded-xl px-4 py-3 text-base leading-relaxed text-white placeholder:text-white/35"
        />
        <p id="tip-message-count" className="text-right text-xs text-white/45">
          {message.length}/{maxMessageLength}
        </p>
      </div>

      {/* ---------- แจ้งเตือนข้อผิดพลาด ---------- */}
      <div role="alert" aria-live="polite">
        {error ? (
          <p className="rounded-xl border border-rose-400/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
      </div>

      {/* ---------- ปุ่มยืนยัน ---------- */}
      <button
        type="submit"
        disabled={isLoading}
        aria-busy={isLoading}
        className="smoke-btn flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-bold text-white disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <span
              aria-hidden="true"
              className="h-5 w-5 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-none"
            />
            กำลังพาไปหน้าจ่ายเงิน...
          </>
        ) : (
          <>
            <span aria-hidden="true">💜</span>
            {finalAmount > 0
              ? `โดเนท ฿${finalAmount.toLocaleString("th-TH")}`
              : "โดเนทเลย"}
          </>
        )}
      </button>

      <p className="text-center text-xs leading-relaxed text-white/50">
        ชำระเงินปลอดภัยผ่าน Stripe · เราไม่เก็บข้อมูลบัตรของคุณ · หลังจ่ายสำเร็จข้อความจะขึ้นสตรีมทันที
      </p>
    </form>
  );
}
