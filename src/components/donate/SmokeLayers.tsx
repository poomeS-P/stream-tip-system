/**
 * ฉากควันพื้นหลังของเว็บรับโดเนท (Smoke theme)
 *
 * - ทำจาก CSS gradient ล้วน ไม่ใช้ไฟล์รูป (จึงไม่มี URL รูปปลอม/404)
 * - เลื่อนช้ามากด้วย transform เท่านั้น (GPU) + ปิดอัตโนมัติเมื่อผู้ใช้ตั้ง prefers-reduced-motion
 * - aria-hidden เพราะเป็นของประดับ ไม่มีข้อมูลสำหรับ screen reader
 */
export default function SmokeLayers() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="smoke-layer smoke-layer--a" />
      <div className="smoke-layer smoke-layer--b hidden sm:block" />
      <div className="smoke-layer smoke-layer--c hidden md:block" />

      {/* ฐานหมอกบาง ๆ ด้านล่าง ให้การ์ดดูมีน้ำหนัก */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
    </div>
  );
}
