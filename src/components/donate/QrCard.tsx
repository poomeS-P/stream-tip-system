import fs from "node:fs";
import path from "node:path";
import Image from "next/image";

/**
 * การ์ดช่องทางโอนตรง (PromptPay QR)
 *
 * ⚠️ จุดที่เจ้าของเว็บต้องตั้งค่าเอง (TODO):
 *   1) วางไฟล์รูป QR ของบัญชีตัวเองไว้ที่  public/promptpay-qr.png  (รูปสี่เหลี่ยมจัตุรัส)
 *      -> การ์ดนี้จะแสดงรูปให้อัตโนมัติ (ถ้ายังไม่มีไฟล์ จะแสดงกล่อง "ยังไม่ตั้งค่า" แทน)
 *   2) เบอร์ PromptPay / ชื่อบัญชี ให้ตั้งเป็น Environment Variable บน Railway:
 *      NEXT_PUBLIC_PROMPTPAY_ID  และ  NEXT_PUBLIC_PROMPTPAY_NAME   (ดู .env.example)
 *   ห้าม commit เบอร์จริงลง git — ใส่ผ่าน env เท่านั้น
 */
const QR_FILE_NAME = "promptpay-qr.png";

export default function QrCard() {
  const hasQrImage = fs.existsSync(path.join(process.cwd(), "public", QR_FILE_NAME));

  const promptPayId = process.env.NEXT_PUBLIC_PROMPTPAY_ID?.trim() ?? "";
  const promptPayName = process.env.NEXT_PUBLIC_PROMPTPAY_NAME?.trim() ?? "";

  return (
    <section
      id="promptpay"
      aria-labelledby="promptpay-heading"
      className="smoke-card rounded-3xl p-6 sm:p-8"
    >
      <h2 id="promptpay-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
        โอนตรงด้วย PromptPay QR
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/70">
        สแกนจ่ายได้ทันทีจากแอปธนาคาร — ระบบจะขึ้นข้อความของคุณบนสตรีมให้อัตโนมัติเมื่อตรวจพบยอดโอน
      </p>

      <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex h-[200px] w-[200px] shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-black/40 p-3">
          {hasQrImage ? (
            <Image
              src={`/${QR_FILE_NAME}`}
              alt={promptPayName ? `PromptPay QR ของ ${promptPayName}` : "PromptPay QR"}
              width={176}
              height={176}
              className="h-[176px] w-[176px] rounded-xl"
              priority={false}
            />
          ) : (
            <p className="px-3 text-center text-xs leading-relaxed text-white/55">
              ยังไม่ได้ตั้งค่า QR
              <span className="mt-1 block font-mono text-[11px] text-white/45">
                public/{QR_FILE_NAME}
              </span>
            </p>
          )}
        </div>

        <div className="w-full space-y-2 text-sm">
          <p className="text-white/80">
            <span className="text-white/55">ชื่อบัญชี: </span>
            {promptPayName || <span className="text-amber-300/90">ยังไม่ได้ตั้งค่า (TODO)</span>}
          </p>
          <p className="text-white/80">
            <span className="text-white/55">PromptPay: </span>
            {promptPayId || <span className="text-amber-300/90">ยังไม่ได้ตั้งค่า (TODO)</span>}
          </p>
          <p className="pt-1 text-xs leading-relaxed text-white/55">
            ตั้งค่าได้ที่ Environment Variable{" "}
            <span className="font-mono text-white/70">NEXT_PUBLIC_PROMPTPAY_NAME</span> /{" "}
            <span className="font-mono text-white/70">NEXT_PUBLIC_PROMPTPAY_ID</span>{" "}
            (ไม่ต้องแก้โค้ด)
          </p>
          <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100/90">
            สถานะ: ช่องทางนี้ยัง<b>ไม่</b>เชื่อมกับระบบตรวจยอดอัตโนมัติ — ใช้การ์ดโดเนทด้านบน (บัตร/PromptPay
            ผ่าน Stripe) เพื่อให้ขึ้นจออัตโนมัติ
          </p>
        </div>
      </div>
    </section>
  );
}
