"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setClientCookie } from "@/lib/client-cookie";

export default function AdminLoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // ทดสอบ token โดยเรียก API ที่ต้องการ auth
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        // บันทึก token ลง cookie (httpOnly ไม่ได้ใน client-side — ใช้ cookie ธรรมดา)
        // ใช้ setClientCookie เพื่อ encode ค่าที่มีอักขระพิเศษ (+, =, /) อย่างถูกต้อง
        setClientCookie("admin_token", token);
        router.push("/admin");
      } else {
        setError("Token ไม่ถูกต้อง กรุณาตรวจสอบใน .env อีกครั้ง");
      }
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-800 rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🛡️</div>
          <h1 className="text-xl font-bold text-white">Admin Login</h1>
          <p className="text-gray-400 text-sm mt-1">ใส่ ADMIN_TOKEN จาก .env</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Admin Token"
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            autoFocus
          />

          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || token.length === 0}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
          >
            {loading ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </main>
  );
}
