"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { clearClientCookie, getClientCookie } from "@/lib/client-cookie";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // อ่าน token จาก Cookie
    // ใช้ getClientCookie() เพื่อไม่ให้ค่าที่มี "=" (base64 padding) ถูกตัดทิ้ง
    const cookieToken = getClientCookie("admin_token");

    if (!cookieToken) {
      router.replace("/admin/login");
      return;
    }

    // ตรวจสอบ token กับ server
    fetch("/api/admin/settings", {
      headers: { Authorization: `Bearer ${cookieToken}` },
    }).then((res) => {
      if (res.ok) {
        setToken(cookieToken);
      } else {
        // Token ไม่ valid — clear cookie และ redirect
        clearClientCookie("admin_token");
        router.replace("/admin/login");
      }
      setChecking(false);
    });
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  if (!token) return null;

  return <AdminDashboard token={token} />;
}
