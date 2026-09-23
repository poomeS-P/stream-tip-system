import Link from "next/link";

export default function CancelPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="text-6xl mb-4">😔</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">ยกเลิกการชำระเงิน</h1>
        <p className="text-gray-500 mb-6">
          ไม่มีการหักเงินจากบัญชีของคุณ
          หากต้องการลองใหม่ สามารถกลับไปส่งทิปได้เลยครับ
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </main>
  );
}
