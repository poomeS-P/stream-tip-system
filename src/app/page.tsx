import type { Metadata } from "next";
import QrCard from "@/components/donate/QrCard";
import SmokeLayers from "@/components/donate/SmokeLayers";
import TipForm from "@/components/tip/TipForm";
import { db } from "@/lib/db";

/**
 * หน้าเว็บรับโดเนท (Smoke theme)
 *
 * ⚠️ จุดที่เจ้าของเว็บต้องเปลี่ยนข้อมูลเอง (TODO) — สรุปไว้ที่ docs/STREAM_DAY_CHECKLIST.md ด้วย
 *   1) ชื่อเว็บ/สตรีมเมอร์ : ตั้งในหน้า Admin (SystemSetting.streamerName) หรือ seed
 *   2) ข้อความ Hero       : แก้ HERO_DESCRIPTION ด้านล่างให้ตรงกับช่องของคุณ
 *   3) เป้าหมายต่อเดือน    : Railway → Variables → SUPPORT_GOAL_THB (ค่าเริ่มต้น 5000, ใส่ 0 = ซ่อนส่วนนี้)
 *   4) QR/PromptPay       : วางไฟล์ public/promptpay-qr.png + ตั้ง NEXT_PUBLIC_PROMPTPAY_NAME/ID
 *   5) ช่องทางติดต่อ       : ตั้ง NEXT_PUBLIC_CONTACT_* (ถ้าไม่ตั้ง จะไม่แสดงลิงก์เลย)
 *   6) ยอดโดเนทขั้นต่ำ      : SystemSetting.minTipAmount (ค่าเริ่มต้น 1 บาท)
 */

/** ข้อความอธิบายว่าเงินสนับสนุนนำไปใช้ทำอะไร (TODO: ปรับให้ตรงกับช่องของคุณ) */
const HERO_DESCRIPTION =
  "ทุกการสนับสนุนช่วยให้ช่องนี้ผลิตคอนเทนต์ต่อไปได้จริง — ค่าไฟ ค่าอินเทอร์เน็ต ค่าอุปกรณ์ และเวลาที่ใช้ทำสตรีม ทุกยอดมีข้อความของคุณขึ้นจอบนสตรีมทันที";

const GOAL_DEFAULT_TARGET = 5000;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "สนับสนุนช่อง (โดเนท) — ขอบคุณทุกการสนับสนุน",
  description: "เว็บรับโดเนทอย่างเป็นทางการ — เลือกยอด ใส่ข้อความ แล้วข้อความของคุณจะขึ้นจอบนสตรีมทันที",
};

function formatBaht(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

/** เวลาปัจจุบัน (ms) — แยกเป็นฟังก์ชันนอก component เพื่อไม่ให้ render ไม่บริสุทธิ์ */
function currentTimeMs(): number {
  return Date.now();
}

/** เวลาที่ผ่านไปแบบสั้น ๆ (ใช้แสดงในรายชื่อผู้สนับสนุน) */
function timeAgo(date: Date, now: number): string {
  const diffMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));

  if (diffMinutes < 1) return "เมื่อสักครู่";
  if (diffMinutes < 60) return `${diffMinutes} นาทีที่แล้ว`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;

  return `${Math.floor(diffHours / 24)} วันที่แล้ว`;
}

export default async function Home() {
  const settings = await db.systemSetting.findUnique({ where: { id: "default" } });

  const minAmount = Math.max(1, settings ? Number(settings.minTipAmount) : 1);
  const maxMessageLength = settings?.maxMessageLength ?? 150;
  const streamerName = settings?.streamerName?.trim() || "Streamer";

  const paidWhere = { paymentTransaction: { is: { status: "SUCCESS" as const } } };

  const [supporters, monthTotal] = await Promise.all([
    db.tip.findMany({
      where: paidWhere,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, donorName: true, amount: true, cleanMessage: true, createdAt: true },
    }),
    db.tip.aggregate({
      where: {
        ...paidWhere,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const goalTarget = Math.max(0, Number(process.env.SUPPORT_GOAL_THB ?? GOAL_DEFAULT_TARGET) || 0);
  const thisMonthTotal = Number(monthTotal._sum.amount ?? 0);
  const supporterCount = monthTotal._count._all;
  const progressPercent = goalTarget > 0 ? Math.min(100, (thisMonthTotal / goalTarget) * 100) : 0;
  const now = currentTimeMs();

  const contactLinks = [
    { label: "Twitch", url: process.env.NEXT_PUBLIC_CONTACT_TWITCH },
    { label: "Discord", url: process.env.NEXT_PUBLIC_CONTACT_DISCORD },
    { label: "X (Twitter)", url: process.env.NEXT_PUBLIC_CONTACT_X },
    { label: "อีเมล", url: process.env.NEXT_PUBLIC_CONTACT_EMAIL },
  ].filter((item): item is { label: string; url: string } => Boolean(item.url && item.url.trim()));

  return (
    <div className="smoke-site scroll-smooth motion-reduce:scroll-auto">
      <SmokeLayers />

      {/* ================= NAVBAR ================= */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07080c]/70 backdrop-blur-xl">
        <nav
          aria-label="เมนูหลัก"
          className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
        >
          <a href="#top" className="flex items-center gap-2 text-base font-semibold tracking-tight text-white">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-xl border border-white/15 bg-white/[0.06] text-sm"
            >
              💜
            </span>
            <span className="max-w-[46vw] truncate sm:max-w-none">{streamerName}</span>
          </a>

          <div className="hidden items-center gap-6 text-sm text-white/70 sm:flex">
            <a className="transition hover:text-white" href="#donate">
              โดเนท
            </a>
            <a className="transition hover:text-white" href="#goal">
              เป้าหมาย
            </a>
            <a className="transition hover:text-white" href="#supporters">
              ผู้สนับสนุน
            </a>
          </div>

          <a href="#donate" className="smoke-btn rounded-xl px-4 py-2 text-sm font-semibold text-white">
            Donate Now
          </a>
        </nav>
      </header>

      <main id="top" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        {/* ================= HERO ================= */}
        <section aria-labelledby="hero-heading" className="py-12 sm:py-20">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs text-white/75">
            <span aria-hidden="true">🫶</span> ขอบคุณทุกคนที่ช่วยให้ช่องนี้ไปต่อ
          </p>

          <h1
            id="hero-heading"
            className="max-w-3xl text-4xl leading-[1.15] font-extrabold tracking-tight sm:text-5xl"
          >
            สนับสนุน{" "}
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">
              {streamerName}
            </span>{" "}
            ด้วยการโดเนท
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
            {HERO_DESCRIPTION}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#donate" className="smoke-btn rounded-2xl px-6 py-3 text-base font-bold text-white">
              <span aria-hidden="true">💜</span> Donate Now
            </a>
            <a
              href="#supporters"
              className="rounded-2xl border border-white/15 bg-white/[0.04] px-6 py-3 text-base font-semibold text-white/85 transition hover:border-white/30 hover:text-white"
            >
              ดูผู้สนับสนุนล่าสุด
            </a>
          </div>

          <dl className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "โดเนทขั้นต่ำ", value: `฿${formatBaht(minAmount)}` },
              { label: "ขึ้นจอบนสตรีม", value: "ทันทีหลังจ่ายสำเร็จ" },
              { label: "ชำระเงินปลอดภัย", value: "ผ่าน Stripe" },
            ].map((item) => (
              <div key={item.label} className="smoke-card rounded-2xl px-4 py-3">
                <dt className="text-xs text-white/60">{item.label}</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ================= DONATION CARD ================= */}
        <section id="donate" aria-labelledby="donate-heading" className="scroll-mt-24 pb-12">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="smoke-card rounded-3xl p-5 sm:p-8">
              <h2 id="donate-heading" className="text-2xl font-bold tracking-tight">
                ส่งข้อความ + โดเนท
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                เลือกยอด ใส่ชื่อและข้อความของคุณ — ระบบจะขึ้นจอบนสตรีมให้อัตโนมัติเมื่อชำระเงินสำเร็จ
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
                หมายเหตุ: ช่องทางบัตร/PromptPay (Stripe) เริ่มที่ ฿10 ต่อรายการ · ส่วนช่องทางโอนตรง
                PromptPay QR เริ่ม ฿1 แต่ยังไม่เปิดใช้งาน (ดูหัวข้อด้านล่าง)
              </p>

              <div className="mt-6">
                <TipForm
                  minAmount={minAmount}
                  currency={process.env.DEFAULT_CURRENCY ?? "THB"}
                  maxMessageLength={maxMessageLength}
                />
              </div>
            </div>

            <aside className="space-y-4" aria-label="ข้อมูลเพิ่มเติมเกี่ยวกับการโดเนท">
              <div className="smoke-card rounded-3xl p-5">
                <h3 className="text-sm font-semibold text-white">ขั้นตอนการสนับสนุน</h3>
                <ol className="mt-4 space-y-3 text-sm text-white/70">
                  {[
                    `เลือกยอดโดเนท (ขั้นต่ำ ฿${formatBaht(minAmount)})`,
                    "กรอกชื่อและข้อความที่จะขึ้นจอ",
                    "ชำระเงินแล้วข้อความขึ้นจอบนสตรีมทันที",
                  ].map((step, index) => (
                    <li key={step} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-violet-300/40 bg-violet-400/15 text-xs font-bold text-violet-100"
                      >
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="smoke-card rounded-3xl p-5 text-sm leading-relaxed text-white/70">
                <h3 className="text-sm font-semibold text-white">ความปลอดภัย</h3>
                <ul className="mt-3 space-y-2">
                  <li className="flex gap-2">
                    <span aria-hidden="true">🔒</span>
                    <span>ชำระผ่าน Stripe — ข้อมูลบัตรไม่ผ่านเซิร์ฟเวอร์ของเรา</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden="true">🧹</span>
                    <span>ข้อความถูกกรองคำไม่เหมาะสมก่อนขึ้นจอ</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden="true">🕒</span>
                    <span>ถ้ามีหลายรายการติดกัน ระบบจะเล่นเรียงคิวให้ครบทุกอัน</span>
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </section>

        {/* ================= QR / PROMPTPAY ================= */}
        <div className="pb-12">
          <QrCard />
        </div>

        {/* ================= GOAL ================= */}
        {goalTarget > 0 ? (
          <section id="goal" aria-labelledby="goal-heading" className="scroll-mt-24 pb-12">
            <div className="smoke-card rounded-3xl p-6 sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="goal-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
                    เป้าหมายการสนับสนุนเดือนนี้
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">
                    เป้าหมาย ฿{formatBaht(goalTarget)} · ได้รับแล้ว ฿{formatBaht(thisMonthTotal)} จาก{" "}
                    {supporterCount} รายการ
                  </p>
                </div>
                <p className="text-3xl font-extrabold tracking-tight text-white">
                  {Math.round(progressPercent)}%
                </p>
              </div>

              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressPercent)}
                aria-label="ความคืบหน้าเป้าหมายการสนับสนุนเดือนนี้"
                className="mt-6 h-3 w-full overflow-hidden rounded-full border border-white/12 bg-black/45"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-300 transition-[width] duration-700 motion-reduce:transition-none"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <p className="mt-3 text-xs text-white/55">
                อัปเดตอัตโนมัติจากรายการที่ชำระสำเร็จแล้ว · รีเซ็ตทุกต้นเดือน
              </p>
            </div>
          </section>
        ) : null}

        {/* ================= SUPPORTERS ================= */}
        <section id="supporters" aria-labelledby="supporters-heading" className="scroll-mt-24 pb-12">
          <div className="smoke-card rounded-3xl p-6 sm:p-8">
            <h2 id="supporters-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
              ขอบคุณผู้สนับสนุนล่าสุด
            </h2>
            <p className="mt-2 text-sm text-white/70">
              {supporters.length > 0
                ? `${supporters.length} รายการล่าสุดที่ชำระเงินสำเร็จแล้ว`
                : "รายการที่ชำระเงินสำเร็จแล้วจะมาแสดงที่นี่"}
            </p>

            {supporters.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-white/12 bg-black/25 px-4 py-8 text-center text-sm text-white/60">
                ยังไม่มีรายการโดเนท — มาเป็นคนแรกที่สนับสนุนช่องนี้ได้เลย 💜
              </p>
            ) : (
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {supporters.map((supporter) => (
                  <li key={supporter.id} className="rounded-2xl border border-white/12 bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-white">
                        <span aria-hidden="true">💜</span> {supporter.donorName}
                      </p>
                      <p className="shrink-0 text-sm font-bold text-amber-200">
                        ฿{formatBaht(Number(supporter.amount))}
                      </p>
                    </div>

                    {supporter.cleanMessage ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/65">
                        {supporter.cleanMessage}
                      </p>
                    ) : null}

                    <p className="mt-2 text-[11px] text-white/45">{timeAgo(supporter.createdAt, now)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-white/10 bg-black/35">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-sm font-semibold text-white">
              <span aria-hidden="true">💜</span> ขอบคุณทุกการสนับสนุน
            </p>
            <p className="mt-1 text-xs text-white/55">
              © {new Date().getFullYear()} {streamerName} · ระบบรับโดเนท + ขึ้นจอบนสตรีม
            </p>
          </div>

          {contactLinks.length > 0 ? (
            <ul aria-label="ช่องทางติดต่อ" className="flex flex-wrap items-center gap-2 text-xs">
              {contactLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-white/75 transition hover:border-white/30 hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
