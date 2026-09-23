import TipForm from "@/components/tip/TipForm";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">💜</div>
          <h1 className="text-2xl font-bold text-gray-800">ส่งทิปให้ Streamer</h1>
          <p className="text-gray-500 text-sm mt-1">
            ข้อความของคุณจะแสดงบน Stream สด!
          </p>
        </div>
        <TipForm />
      </div>
    </main>
  );
}
