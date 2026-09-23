"use client";

import { useState } from "react";

const AMOUNT_PRESETS = [20, 50, 100, 200, 500];

export default function TipForm() {
  const [donorName, setDonorName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [amount, setAmount] = useState<number | "">("");
  const [customAmount, setCustomAmount] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const finalAmount = amount !== "" ? amount : parseFloat(customAmount) || 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (finalAmount <= 0) {
      setError("กรุณาระบุจำนวนเงิน");
      return;
    }
    if (!isAnonymous && donorName.trim().length === 0) {
      setError("กรุณาระบุชื่อ หรือเลือก Anonymous");
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

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
        return;
      }

      // Redirect ไปยัง Stripe Hosted Checkout
      window.location.href = data.checkoutUrl;
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ชื่อผู้บริจาค */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          ชื่อของคุณ
        </label>
        <input
          type="text"
          value={donorName}
          onChange={(e) => setDonorName(e.target.value)}
          disabled={isAnonymous}
          placeholder="ชื่อที่จะแสดงบน Stream"
          maxLength={50}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100 disabled:cursor-not-allowed transition"
        />
        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            className="rounded accent-purple-600"
          />
          <span className="text-sm text-gray-600">Anonymous (ไม่เปิดเผยชื่อ)</span>
        </label>
      </div>

      {/* จำนวนเงิน */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          จำนวนเงิน (บาท)
        </label>
        <div className="grid grid-cols-5 gap-2 mb-3">
          {AMOUNT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => { setAmount(preset); setCustomAmount(""); }}
              className={`py-2 rounded-lg border text-sm font-semibold transition ${
                amount === preset
                  ? "bg-purple-600 border-purple-600 text-white"
                  : "border-gray-300 hover:border-purple-400 hover:text-purple-600"
              }`}
            >
              ฿{preset}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={customAmount}
          onChange={(e) => { setCustomAmount(e.target.value); setAmount(""); }}
          placeholder="หรือพิมพ์จำนวนที่ต้องการ..."
          min={1}
          max={100000}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
        />
      </div>

      {/* ข้อความ */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          ข้อความ (ไม่บังคับ)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="ส่งข้อความถึง Streamer..."
          maxLength={150}
          rows={3}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none transition"
        />
        <p className="text-xs text-gray-400 text-right mt-1">{message.length}/150</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading || finalAmount <= 0}
        className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-lg"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            กำลังเชื่อมต่อ...
          </span>
        ) : (
          <>💜 ส่งทิป {finalAmount > 0 ? `฿${finalAmount}` : ""}</>
        )}
      </button>

      <p className="text-xs text-center text-gray-400">
        ชำระเงินผ่าน Stripe (ปลอดภัย · ไม่เก็บข้อมูลบัตร)
      </p>
    </form>
  );
}
