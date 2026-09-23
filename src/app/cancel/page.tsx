import Link from "next/link";

/**
 * หน้าหลังยกเลิกการชำระเงิน (ธีมขาว มินิมอล — ให้ต่อเนื่องกับหน้าโดเนท)
 * แค่แจ้งสถานะให้ผู้ชมรับรู้ ไม่มีการแก้ข้อมูลใด ๆ
 */
export default function CancelPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-5 py-14 sm:px-6">
      <div className="w-full max-w-[420px] text-center">
        <div className="text-[44px]" aria-hidden="true">
          😔
        </div>

        <h1 className="mt-4 text-[22px] font-bold tracking-tight text-ink">ยกเลิกการชำระเงิน</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
          ไม่มีการหักเงินจากบัญชีของคุณ — หากต้องการลองใหม่ กลับไปหน้าโดเนทได้เลยครับ
        </p>

        <Link
          href="/"
          className="pay-btn mt-8 inline-block rounded-[12px] px-6 py-3 text-[15px] font-semibold"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </main>
  );
}
