# Stream Day Checklist — เปิด/เช็คอะไรบ้างหลังรีสตาร์ทเครื่อง

> **สรุปสั้น:** ระบบ Donate อยู่บน **Railway (คลาวด์ ทำงาน 24/7)** → **ไม่ต้องสตาร์ทอะไรในเครื่องเลย**
> ส่วนใหญ่แค่เปิด OBS + เช็ค 1 นาที

---

## ✅ ก่อนไลฟ์ (1 นาที)

- [ ] ต่ออินเทอร์เน็ต (ทั้งไทยและเพื่อนที่มาไลฟ์)
- [ ] เช็คว่าระบบยังทำงาน — เปิด `https://stream-tip-system-production.up.railway.app/api/health`
      ต้องได้ `{"ok":true,"database":"up",...}` (เช็คจากมือถือก็ได้)
      ถ้าไม่ขึ้น `up` → Railway → service → **Restart** แล้วเช็คซ้ำ
- [ ] เปิด `https://stream-tip-system-production.up.railway.app/admin/login` → ใส่ `ADMIN_TOKEN`
      → การ์ด **🧪 ทดสอบ Alert** → กด **"ส่ง Test Alert ไปยัง OBS"** → การ์ดเด้ง = พร้อมไลฟ์ ✅
      (ตรวจว่า 🚨 Emergency Controls ปิดอยู่ทั้ง Alert และ TTS)

## 🖥️ เปิดในเครื่อง (เฉพาะที่ใช้จริง)

| ต้องเปิด | วิธี | ใช้ทำอะไร |
|---|---|---|
| **OBS Studio** | เปิดตามปกติ | ไลฟ์ + Browser Source |
| **ระบบ Overlay เก่า** (`poomes-stream-system`) | ดับเบิลคลิก `C:\Users\Acer\Desktop\Twitch\poomes-stream-system\start-overlay.bat` (หรือ `serve-loop.bat` ถ้าอยากให้รีสตาร์ทตัวเองเมื่อโปรเซสตาย) | follower alert / latest follower / goal / cam / character (พอร์ต `3000`) |
| ❌ **ไม่ต้องเปิด** | `npm run dev` (พอร์ต 3300) · Docker Desktop + Postgres local · Stripe CLI (`stripe listen`) | ทั้ง 3 อย่างนี้ใช้เฉพาะตอนพัฒนา/ทดสอบในเครื่อง ไม่เกี่ยวกับการไลฟ์ |

## 📺 Browser Source ใน OBS (URL)

| Source | URL | ตั้งค่า |
|---|---|---|
| **Donate overlay** (ระบบใหม่) | `https://stream-tip-system-production.up.railway.app/overlay?token=<OVERLAY_TOKEN>` | 1920×1080 · พื้นหลังโปร่งใส · ติ๊ก *Refresh browser when scene becomes active* |
| **Alert + Latest + Goal** (ระบบเก่า) | `http://localhost:3000/alert?motion=1&latest=1&goal=1` (หรือแยกใบตาม `OBS-SETUP.md`) | ใช้ได้เฉพาะเครื่องที่รันระบบเก่าเท่านั้น |

- ค่า `OVERLAY_TOKEN` ดูได้ที่ Railway → service → **Variables** → `OVERLAY_TOKEN` (หรือไฟล์ `.env.railway.local`)
- 🔒 **อย่าแชร์ URL ที่มี token ให้คนอื่น** — ใครมี token จะเชื่อมสตรีมแจ้งเตือน/ACK ได้
- 💨 **ควันรอบข้อความ (Donate overlay)** ใช้เอนจินตัวเดียวกับการ์ดแจ้งเตือน Follow ของระบบเก่า
  - ปรับได้ท้าย URL เช่น `&smoke=A2` (พรีเซ็ต: A=กลม · B=ฟู · C=สายไอ, เลข 1=เบา 2=กลาง 3=หนัก)
  - ตัวคูณเฉพาะการ์ดกว้าง: `&smokespreadx=1.75&smokespready=1.15&smokesize=1.1&smokecount=1.85&smokeop=1` (`&smokefit=1` = ปิดตัวคูณ)
  - อยากให้โผล่ไวขึ้น/ช้าลง: `&enterMs=800` · `&exitMs=600`
  - ต้นทางเอนจิน: `poomes-stream-system/views/alert.html` → sync ด้วย `node scripts/extract-smoke-engine.mjs`

## 💸 ลิงก์รับโดเนท (ส่งให้ผู้ชม / ทำ QR)

- `https://stream-tip-system-production.up.railway.app/`
- หลังจ่าย หน้าจะพากลับมาที่ `/success` และแจ้งสถานะจาก DB จริง (ไม่เชื่อค่าจากเบราว์เซอร์)

## 🧰 ถ้ามีปัญหา

| อาการ | เช็คอะไร |
|---|---|
| overlay ขึ้น**หน้าส่งทิป** | token ใน URL ผิด/หาย → คัดลอกใหม่จาก Railway Variables (ต้องมี `?token=...` ครบ) |
| กด Test Alert แล้วการ์ดไม่เด้ง | 🚨 Emergency Controls ต้องปิดทั้ง Alert/TTS · overlay ต้องเปิดอยู่/กด Refresh source |
| **จ่ายจริงแล้วการ์ดไม่เด้ง** | Stripe Dashboard → Developers → **Webhooks** → ต้องมี endpoint `https://<domain>/api/webhooks/payment` + Recent deliveries = **200** และ `STRIPE_WEBHOOK_SECRET` ใน Railway ต้องตรงกับ endpoint นั้น |
| overlay เก่าขึ้น **404** | ยังไม่ได้รัน `start-overlay.bat` หรือมีโปรแกรมอื่นยึดพอร์ต 3000 |
| follower/goal ไม่อัปเดต | เปิด `http://localhost:3000/auth/twitch` เพื่อล็อกอิน Twitch ใหม่ (token หมดอายุ) |
| ระบบล่มทั้งหมด | Railway → service → **Restart** → เช็ค `/api/health` |

## 📌 สถานะที่ตกลงกันไว้

- ยังใช้ Stripe **Test Mode** (ยังไม่เปลี่ยนเป็น Live) — เมื่อพร้อมค่อยเปลี่ยน `STRIPE_SECRET_KEY` + สร้าง webhook endpoint โหมด Live + อัปเดต `STRIPE_WEBHOOK_SECRET` แล้ว redeploy (ไม่ต้องแก้โค้ด)
- Database production: schema ถูกสร้าง/อัปเดตอัตโนมัติทุกครั้งที่ deploy (entrypoint รัน `prisma migrate deploy` + seed ครั้งแรก) → ไม่ต้องทำมือ
