import Link from "next/link";
import SmokeLayers from "@/components/donate/SmokeLayers";

export default function CancelPage() {
  return (
    <main className="smoke-site flex items-center justify-center p-4">
      <SmokeLayers />

      <div className="smoke-card w-full max-w-md rounded-3xl p-8 text-center">
        <div className="mb-4 text-6xl" aria-hidden="true">
          😔
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-white">ยกเลิกการชำระเงิน</h1>
        <p className="mb-6 text-sm leading-relaxed text-white/70">
          ไม่มีการหักเงินจากบัญชีของคุณ — หากต้องการลองใหม่ กลับไปหน้าโดเนทได้เลยครับ
        </p>
        <Link
          href="/"
          className="smoke-btn inline-block rounded-2xl px-6 py-3 font-semibold text-white"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </main>
  );
}
