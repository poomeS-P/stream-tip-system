"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface Tip {
  id: string;
  donorName: string;
  isAnonymous: boolean;
  amount: number;
  currency: string;
  message: string | null;
  cleanMessage: string | null;
  hasFilteredWord: boolean;
  createdAt: string;
  paymentTransaction: {
    status: string;
    paidAt: string | null;
    amountCharged: number;
    provider: string;
  } | null;
  alertQueue: {
    status: string;
    displayedAt: string | null;
    completedAt: string | null;
  } | null;
}

interface AdminDashboardProps {
  token: string;
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  SUCCESS: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-gray-100 text-gray-600",
  PLAYING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  SKIPPED: "bg-gray-100 text-gray-600",
  BLOCKED: "bg-red-100 text-red-800",
};

export default function AdminDashboard({ token }: AdminDashboardProps) {
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [testAlert, setTestAlert] = useState({ donorName: "Test User", amount: 100, message: "ทดสอบ Alert! 🎉" });
  const [emergency, setEmergency] = useState({ alertMuted: false, ttsMuted: false });
  const [actionMsg, setActionMsg] = useState("");
  const [settings, setSettings] = useState<{
    bannedWords: string[];
    blockEntireMessage: boolean;
    minTipAmount: number;
    maxMessageLength: number;
    minAmountForTTS: number;
    alertDurationSec: number;
  } | null>(null);
  const [bannedWordsText, setBannedWordsText] = useState("");

  // ใช้ useMemo เพื่อให้ header object มี reference คงที่ต่อ 1 token
  // ทำให้ dependency ของ useCallback ถูกต้องครบถ้วน (ไม่ต้องใช้ eslint-disable)
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchTips = useCallback(async () => {
    const res = await fetch("/api/admin/tips?limit=30", { headers: authHeader });
    if (res.ok) {
      const data = await res.json();
      setTips(data.tips);
    }
    setLoading(false);
  }, [authHeader]);

  const fetchEmergency = useCallback(async () => {
    const res = await fetch("/api/admin/emergency", { headers: authHeader });
    if (res.ok) {
      const data = await res.json();
      setEmergency({ alertMuted: data.emergencyAlertMuted, ttsMuted: data.emergencyTTSMuted });
    }
  }, [authHeader]);

  const fetchSettings = useCallback(async () => {
    const res = await fetch("/api/admin/settings", { headers: authHeader });
    if (res.ok) {
      const data = await res.json();
      setSettings(data);
      setBannedWordsText(data.bannedWords.join(", "));
    }
  }, [authHeader]);

  useEffect(() => {
    // เรียก loader ผ่าน async IIFE เพื่อให้ setState เกิด "หลัง await"
    // ไม่ใช่ setState แบบ synchronous ใน effect body (ตามกฎ react-hooks/set-state-in-effect)
    void (async () => {
      await fetchTips();
      await fetchEmergency();
      await fetchSettings();
    })();

    // รีเฟรชรายการทิปอัตโนมัติทุก 10 วินาที
    const interval = setInterval(() => {
      void fetchTips();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchTips, fetchEmergency, fetchSettings]);

  async function handleTestAlert() {
    const res = await fetch("/api/alerts/test", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(testAlert),
    });
    if (res.ok) {
      showMsg("✅ ส่ง Test Alert แล้ว!");
    } else {
      showMsg("❌ ส่ง Alert ล้มเหลว");
    }
  }

  async function handleSkip() {
    const res = await fetch("/api/admin/queue/skip", { method: "POST", headers: authHeader });
    if (res.ok) showMsg("⏭️ ข้าม Alert แล้ว");
  }

  async function handleClearQueue() {
    if (!confirm("ล้างคิว Alert ที่ค้างอยู่ทั้งหมด?")) return;
    const res = await fetch("/api/admin/queue/clear", { method: "POST", headers: authHeader });
    if (res.ok) {
      const data = await res.json();
      showMsg(`🗑️ ล้างคิวแล้ว ${data.clearedCount} รายการ`);
    }
  }

  async function handleEmergencyToggle(field: "alertMuted" | "ttsMuted") {
    const newValue = !emergency[field];
    const res = await fetch("/api/admin/emergency", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        alertMuted: field === "alertMuted" ? newValue : emergency.alertMuted,
        ttsMuted: field === "ttsMuted" ? newValue : emergency.ttsMuted,
      }),
    });
    if (res.ok) {
      setEmergency((prev) => ({ ...prev, [field]: newValue }));
      showMsg(newValue ? `🔴 ${field === "alertMuted" ? "Alert" : "TTS"} ถูกปิดแล้ว` : `🟢 ${field === "alertMuted" ? "Alert" : "TTS"} เปิดใช้งานแล้ว`);
    }
  }

  async function handleSaveSettings() {
    const words = bannedWordsText.split(",").map((w) => w.trim()).filter(Boolean);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, bannedWords: words }),
    });
    if (res.ok) showMsg("✅ บันทึกการตั้งค่าแล้ว");
    else showMsg("❌ บันทึกล้มเหลว");
  }

  function showMsg(msg: string) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 4000);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-purple-400">🎮 Admin Dashboard</h1>
          {actionMsg && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-sm animate-fade-in">
              {actionMsg}
            </div>
          )}
        </div>

        {/* Emergency Controls */}
        <section className="bg-gray-900 rounded-2xl p-5 border border-red-900/40">
          <h2 className="text-lg font-semibold text-red-400 mb-4">🚨 Emergency Controls</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleEmergencyToggle("alertMuted")}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition ${
                emergency.alertMuted
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              {emergency.alertMuted ? "🔴 Alert: ปิดอยู่ — คลิกเปิด" : "🟢 Alert: เปิดอยู่ — คลิกปิด"}
            </button>
            <button
              onClick={() => handleEmergencyToggle("ttsMuted")}
              className={`px-5 py-3 rounded-xl font-bold text-sm transition ${
                emergency.ttsMuted
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              {emergency.ttsMuted ? "🔴 TTS: ปิดอยู่ — คลิกเปิด" : "🟢 TTS: เปิดอยู่ — คลิกปิด"}
            </button>
            <button
              onClick={handleSkip}
              className="px-5 py-3 bg-orange-700 hover:bg-orange-600 rounded-xl font-bold text-sm transition"
            >
              ⏭️ ข้าม Alert ปัจจุบัน
            </button>
            <button
              onClick={handleClearQueue}
              className="px-5 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold text-sm transition"
            >
              🗑️ ล้างคิวทั้งหมด
            </button>
          </div>
        </section>

        {/* Test Alert */}
        <section className="bg-gray-900 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-purple-400 mb-4">🧪 ทดสอบ Alert</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              value={testAlert.donorName}
              onChange={(e) => setTestAlert((p) => ({ ...p, donorName: e.target.value }))}
              placeholder="ชื่อผู้บริจาค"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
            />
            <input
              type="number"
              value={testAlert.amount}
              onChange={(e) => setTestAlert((p) => ({ ...p, amount: Number(e.target.value) }))}
              placeholder="จำนวนเงิน"
              min={1}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
            />
            <input
              type="text"
              value={testAlert.message}
              onChange={(e) => setTestAlert((p) => ({ ...p, message: e.target.value }))}
              placeholder="ข้อความ"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
            />
          </div>
          <button
            onClick={handleTestAlert}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold transition"
          >
            ส่ง Test Alert ไปยัง OBS
          </button>
        </section>

        {/* Settings */}
        {settings && (
          <section className="bg-gray-900 rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-purple-400 mb-4">⚙️ ตั้งค่าระบบ</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <label className="block">
                <span className="text-xs text-gray-400">ทิปขั้นต่ำ (บาท)</span>
                <input
                  type="number"
                  value={settings.minTipAmount}
                  onChange={(e) => setSettings((p) => p ? { ...p, minTipAmount: Number(e.target.value) } : p)}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-400">ความยาวข้อความสูงสุด</span>
                <input
                  type="number"
                  value={settings.maxMessageLength}
                  onChange={(e) => setSettings((p) => p ? { ...p, maxMessageLength: Number(e.target.value) } : p)}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-400">ขั้นต่ำสำหรับ TTS (บาท)</span>
                <input
                  type="number"
                  value={settings.minAmountForTTS}
                  onChange={(e) => setSettings((p) => p ? { ...p, minAmountForTTS: Number(e.target.value) } : p)}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-400">ระยะเวลา Alert (วินาที)</span>
                <input
                  type="number"
                  value={settings.alertDurationSec}
                  onChange={(e) => setSettings((p) => p ? { ...p, alertDurationSec: Number(e.target.value) } : p)}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
                />
              </label>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">
                คำหยาบ / Blocklist (คั่นด้วยคอมมา)
              </label>
              <textarea
                value={bannedWordsText}
                onChange={(e) => setBannedWordsText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm resize-none"
              />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.blockEntireMessage}
                  onChange={(e) => setSettings((p) => p ? { ...p, blockEntireMessage: e.target.checked } : p)}
                  className="rounded accent-purple-500"
                />
                <span className="text-sm text-gray-300">ซ่อนข้อความทั้งหมดถ้าพบคำหยาบ (แทนการทำดาว)</span>
              </label>
            </div>
            <button
              onClick={handleSaveSettings}
              className="px-5 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold transition"
            >
              💾 บันทึกการตั้งค่า
            </button>
          </section>
        )}

        {/* Tip History */}
        <section className="bg-gray-900 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-purple-400">📋 ประวัติทิป</h2>
            <button onClick={fetchTips} className="text-xs text-gray-400 hover:text-white transition">
              🔄 รีเฟรช
            </button>
          </div>

          {loading ? (
            <div className="text-center text-gray-500 py-8">กำลังโหลด...</div>
          ) : tips.length === 0 ? (
            <div className="text-center text-gray-500 py-8">ยังไม่มีทิป</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-left border-b border-gray-800">
                    <th className="pb-2 pr-4">ชื่อ</th>
                    <th className="pb-2 pr-4">จำนวน</th>
                    <th className="pb-2 pr-4">ข้อความ</th>
                    <th className="pb-2 pr-4">Payment</th>
                    <th className="pb-2 pr-4">Alert</th>
                    <th className="pb-2">เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {tips.map((tip) => (
                    <tr key={tip.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{tip.donorName}</span>
                        {tip.isAnonymous && <span className="ml-1 text-xs text-gray-500">(anon)</span>}
                      </td>
                      <td className="py-2 pr-4 text-green-400 font-semibold">
                        ฿{Number(tip.amount).toLocaleString("th-TH")}
                      </td>
                      <td className="py-2 pr-4 text-gray-300 max-w-[200px] truncate">
                        {tip.hasFilteredWord && <span className="text-yellow-500 mr-1">⚠️</span>}
                        {tip.cleanMessage ?? tip.message ?? "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[tip.paymentTransaction?.status ?? ""] ?? "bg-gray-700 text-gray-400"}`}>
                          {tip.paymentTransaction?.status ?? "N/A"}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[tip.alertQueue?.status ?? ""] ?? "bg-gray-700 text-gray-400"}`}>
                          {tip.alertQueue?.status ?? "N/A"}
                        </span>
                      </td>
                      <td className="py-2 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(tip.createdAt).toLocaleString("th-TH", {
                          timeZone: "Asia/Bangkok",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
