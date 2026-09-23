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
| **Donate overlay** (ระบบใหม่ · ภาพ+เสียงเตือน) | `https://stream-tip-system-production.up.railway.app/overlay?token=<OVERLAY_TOKEN>&tts=0` | 1920×1080 · พื้นหลังโปร่งใส · ติ๊ก *Refresh browser when scene becomes active* |
| **ตัวอ่านเสียง (Edge)** (ระบบใหม่ · เสียงอ่าน) | `https://stream-tip-system-production.up.railway.app/overlay/voice?token=<OVERLAY_TOKEN>` เปิดด้วย Edge (ดูหัวข้อ 🎙️ ถัดไป) | เปิดคู่กับ OBS แล้วย่อหน้าต่างไว้ |
| **Alert + Latest + Goal** (ระบบเก่า) | `http://localhost:3000/alert?motion=1&latest=1&goal=1` (หรือแยกใบตาม `OBS-SETUP.md`) | ใช้ได้เฉพาะเครื่องที่รันระบบเก่าเท่านั้น |

> `&tts=0` = ปิดการอ่านเสียงของหน้าต่าง OBS (ยังเล่นเสียง alert + วาดการ์ดตามปกติ) เพราะให้ Edge เป็นคนอ่านเสียงแทน
> ถ้าไม่ต้องการ Edge ก็ลบ `&tts=0` ออกได้ — แต่จะได้เสียงไทยผู้ชาย (Pattara) เพราะ OBS เห็นเฉพาะเสียงที่ติดตั้งใน Windows

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

## 🎬 พฤติกรรม Alert ตอนมีโดเนท (คิว + เวลาที่ค้างบนจอ)

- **โดเนทมาพร้อมกัน 2 อัน → เล่นเรียงกันทีละอัน ไม่ทับกันและไม่หาย**
  - Server จัดคิวด้วยตาราง `AlertQueue` (PENDING → PLAYING → COMPLETED) — อันที่ 2 จะค้างเป็น PENDING
    แล้วถูกส่งให้ OBS ทันทีที่อันแรกแสดงจบ (OBS ACK อัตโนมัติ)
  - Overlay เองมีคิวสำรองอีกชั้น (สูงสุด 10 รายการ) — ถ้าข้อมูลหลุดมาพร้อมกันก็ยังเล่นเรียงกัน
  - ปุ่มใน Admin ใช้ได้เหมือนเดิม: **Skip** = ข้ามอันปัจจุบันแล้วไปอันถัดไป, **Clear** = ล้างคิวที่รออยู่
  - เผื่อเหตุ OBS ปิดกลางคัน (ไม่มี ACK) ระบบจะปิดรายการที่ค้าง PLAYING ให้เองหลังเลยกำหนดแสดง ~30 วิ → คิวไม่ตัน
- **เวลาที่ค้างบนจอ = เวลาขั้นต่ำ + ยืดตามความยาวข้อความ**
  - เวลาขั้นต่ำมาจากฐานข้อมูล `SystemSetting.alertDurationSec` (ค่าเริ่มต้น 8 วิ — ถ้ายังไม่มีช่องในหน้า Admin ให้แก้ผ่าน DB/seed)
  - ข้อความสั้น → ใช้เวลาขั้นต่ำ · ข้อความยาว → อยู่ยาวขึ้นจนอ่านจบ · เพดานเริ่มต้น 20 วิ (กันค้างข้ามรายการ)
  - ปรับได้ด้วย Environment Variable บน Railway:
    `ALERT_READ_MS_PER_CHAR` (ค่าเริ่มต้น `110` ms/ตัวอักษร) · `ALERT_READ_BASE_MS` (`2500`) · `ALERT_MAX_DURATION_SEC` (`20`)
  - ตัวอย่างที่วัดจริง: ข้อความสั้น = 8 วิ · ข้อความยาว ~75 ตัวอักษร = 14 วิ
- **ถ้าเจออาการผิดปกติ** (เช่น การ์ดขึ้นแวบเดียวแล้วหาย) → เติม `&alertdiag=1` ท้าย URL ของ source ชั่วคราว
  จะมีไทม์ไลน์มุมล่างซ้ายบอกว่า `play` / `queue +1` / `finish` / `idle` เกิดเมื่อไรและด้วย id ไหน → ส่งภาพมาได้เลย

## 🎨 หน้าเว็บรับโดเนท (ธีมขาว มินิมอล) — จุดที่ต้องตั้งค่าเอง

หน้าเว็บผู้ชม (`/`, `/success`, `/cancel`) ใช้ธีมขาวสะอาด: พื้นขาว · เส้นขอบบาง 1px · accent เดียว `#4f46e5`
ไม่มี gradient / เงาหนัก / องค์ประกอบเกินจำเป็น — เหลือคอลัมน์เดียวกลางหน้า (หัวข้อ → ชื่อ → จำนวนเงิน → ข้อความ → ปุ่มจ่ายเงิน)

| อยากเปลี่ยนอะไร | แก้ที่ |
|---|---|
| **ยอดโดเนทขั้นต่ำ** | หน้า Admin → `minTipAmount` (ค่าเริ่มต้น **1 บาท** ตาม migration `20260923120000_min_tip_amount_one_baht`) |
| **ความยาวข้อความสูงสุด** | หน้า Admin → `maxMessageLength` (ค่าเริ่มต้น 150 ตัวอักษร) |
| **หัวข้อ/คำอธิบายบนหน้า** | `src/app/page.tsx` (H1 “ร่วมสนับสนุน” + ข้อความใต้หัวข้อ) |
| **จำนวนเงินที่แนะนำ (10/20/50/100/300)** | `AMOUNT_PRESETS` ใน `src/components/tip/TipForm.tsx` |
| **สี accent / ระยะห่าง** | token ใน `@theme` ที่ `src/app/globals.css` |
| **ฟอนต์ไทย** | `Noto_Sans_Thai` ใน `src/app/layout.tsx` |
| **ช่องทางชำระเงิน** | Stripe Hosted Checkout (บัตร/PromptPay) — ลิงก์จ่ายเงินสร้างจาก `POST /api/tips` |

> ⚠️ Stripe บังคับยอดขั้นต่ำ **฿10 ต่อ 1 Checkout Session** (`amount_too_small`) — โค้ดจึงแยกเป็น 2 ชั้น:
> ชั้นนโยบายเว็บ = `minTipAmount` และชั้นช่องทาง = `PROVIDER_MINIMUM_AMOUNT` ใน `src/lib/payment/limits.ts`
> ฟอร์มแสดงข้อความไทยตรง ๆ เมื่อยอดต่ำกว่านั้น และปุ่ม “จ่ายเงิน” จะ disabled จนกว่าข้อมูลสำคัญจะครบ

> 🔴 **ตรวจโหมดคีย์ก่อนทดสอบจ่ายเงินทุกครั้ง:** `STRIPE_SECRET_KEY` ที่ใช้ต้องขึ้นต้นด้วย `sk_test_` / `rk_test_`
> ถ้าเป็น `sk_live_` / `rk_live_` = **ตัดเงินจริงทันที** (ตรวจทั้งไฟล์ `.env` ในเครื่อง และ Variables บน Railway)
> และ `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_` / `pk_live_`) ต้องเป็นโหมดเดียวกับ secret key เสมอ

> หมายเหตุ: หน้า Admin/Overlay ไม่ถูกแตะ — ธีมขาวใช้เฉพาะหน้าเว็บรับโดเนทเท่านั้น
> ส่วนเป้าหมายต่อเดือน · รายชื่อผู้สนับสนุนล่าสุด · การ์ด PromptPay QR ถูกตัดออกจากหน้าเว็บแล้ว (เหลือเฉพาะฟอร์มโดเนท)

## 🎙️ ตั้งค่า Edge ให้เป็น "ตัวอ่านเสียง" (ได้เสียงหญิงไทยธรรมชาติ)

OBS (CEF) เห็นเฉพาะเสียงที่ติดตั้งใน Windows → บนเครื่องนี้มีแค่ `Pattara` (ชาย)
ส่วน **Edge มีเสียงหญิงไทยธรรมชาติ `Microsoft เปรมวดี Online (Natural)`** จึงให้ Edge เป็นคนอ่านเสียงแทน

**สร้าง shortcut ครั้งเดียว** (คลิกขวาที่ Desktop → New → Shortcut) แล้วใส่เป็น Target:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="https://stream-tip-system-production.up.railway.app/overlay/voice?token=<OVERLAY_TOKEN>" --autoplay-policy=no-user-gesture-required
```

**ทุกครั้งก่อนไลฟ์**

1. เปิด OBS — Browser Source ของ Donate overlay ต้องมี `&tts=0` (การ์ด + เสียงเตือนยังออกจาก OBS)
2. ดับเบิลคลิก shortcut Edge → **ย่อหน้าต่างไว้** (เสียงยังออกตามปกติ)
3. ถ้าเห็นแถบเหลือง “เบราว์เซอร์ยังไม่อนุญาตให้เล่นเสียง” → กดปุ่ม **▶ ทดสอบเสียง** 1 ครั้ง
4. ทดสอบจริง: Admin → 🧪 ทดสอบ Alert → การ์ดเด้งใน OBS + ได้ยินเสียงผู้หญิงอ่าน

**ข้อควรรู้**

- เสียงของ Edge ต้องออกลำโพงชุดเดียวกับที่ OBS Capture (Desktop Audio) ไม่เช่นนั้นคนดูจะไม่ได้ยิน
- หน้าต่าง Edge ต้องเปิดค้างไว้ตลอดไลฟ์ (ย่อได้ แต่ห้ามปิด) และต้องต่ออินเทอร์เน็ต
- หน้า `/overlay/voice` **ไม่วาดการ์ดและไม่ ACK คิว** → คิว/ระยะเวลาบนจอยังเหมือนเดิม (OBS เป็นคน ACK)
- ใช้ได้เฉพาะ **Edge** (Chrome ไม่มีเสียงไทย) — ถ้าเปิดด้วย Chrome จะเห็นคำเตือนและได้เสียงผู้ชาย


ระบบอ่านข้อความใช้ **Web Speech API ของเบราว์เซอร์ใน OBS** จึงใช้ได้เฉพาะ "เสียงที่ติดตั้งอยู่ในเครื่องนี้"
(ไม่ใช่เสียงจากคลาวด์) — โค้ดจะเลือก **เสียงไทยผู้หญิง/ธรรมชาติ** ให้ก่อนโดยอัตโนมัติ ถ้าไม่มีจึงถอยไปใช้เสียงผู้ชาย

| อยากทำอะไร | วิธี |
|---|---|
| **ดูว่าเลือกเสียงอะไรอยู่** | เติม `&ttsdiag=1` ท้าย URL ของ Browser Source ชั่วคราว → แผงมุมล่างขวาจะโชว์รายชื่อเสียงไทยทั้งหมด + เสียงที่ถูกเลือก |
| ปรับความเร็ว/ระดับเสียงชั่วคราว | เติม `&ttsrate=0.92` (0.5–1.6) · `&ttspitch=1.08` (0.5–1.6) ท้าย URL |
| บังคับใช้เสียงที่ต้องการ | เติม `&ttsvoice=premwadee` (หรือชื่อเสียงอื่นที่เห็นในแผง diag) |
| ปิดการอ่านเสียงของหน้าต่างนั้น | เติม `&tts=0` (ใช้ที่ Browser Source ของ OBS เมื่อให้ Edge เป็นคนอ่านเสียง) |
| ค่าเริ่มต้นของระบบ | rate `0.98` · pitch `1.08` · อ่านตัวเลขเป็นคำไทย (300 → "สามร้อยบาท") · ตัด emoji/★/URL ให้เอง |

| อาการที่เจอ | สาเหตุ | ทางแก้ |
|---|---|---|
| เสียงอ่านเป็น **ผู้ชาย** | `&ttsdiag=1` จะขึ้น “พบแต่เสียงไทยผู้ชาย” — OBS เห็นแค่ `Microsoft Pattara` (ชาย) | ใช้หัวข้อ 🎙️ ด้านบน (Edge เป็นตัวอ่านเสียง → ได้เสียงหญิงธรรมชาติ) หรือถ้าอนาคตต้องการให้ OBS อ่านเอง ต้องติดตั้งเสียงหญิงไทยเพิ่มใน Windows |
| **อ่านซ้ำสองเสียง** | เปิดทั้ง OBS และ Edge พร้อมกันแต่อันใดอันหนึ่งยังไม่ได้ปิด TTS | ตรวจว่า Browser Source ของ OBS มี `&tts=0` และหน้า Edge คือ `/overlay/voice` |
| **ไม่มีเสียงอ่าน** | ไม่มีเสียงไทยในเครื่อง / autoplay policy | เช็ค `&ttsdiag=1` ว่ามีเสียงไทยไหม · กด **▶ ทดสอบเสียง** ที่หน้าต่าง Edge 1 ครั้ง · เช็ค Audio Mixer ของ OBS |
| อ่านเพี้ยน/อ่านตัวเลขมั่ว | เคยใช้เสียงอังกฤษอ่านข้อความไทย | ตรวจว่าใช้โค้ดล่าสุด (ระบบเลือกเสียงไทยให้เอง) แล้วกด **Refresh** ที่ Browser Source |

> หมายเหตุ: เสียงหญิงไทยธรรมชาติ (`Microsoft เปรมวดี Online (Natural)`) เปิดให้ใช้ผ่าน **Edge** เท่านั้น
> ส่วน OBS (CEF) เห็นเฉพาะเสียงที่ติดตั้งใน Windows ซึ่งบนเครื่องนี้มีแค่ `Pattara` (ชาย)


- ยังใช้ Stripe **Test Mode** (ยังไม่เปลี่ยนเป็น Live) — เมื่อพร้อมค่อยเปลี่ยน `STRIPE_SECRET_KEY` + สร้าง webhook endpoint โหมด Live + อัปเดต `STRIPE_WEBHOOK_SECRET` แล้ว redeploy (ไม่ต้องแก้โค้ด)
- Database production: schema ถูกสร้าง/อัปเดตอัตโนมัติทุกครั้งที่ deploy (entrypoint รัน `prisma migrate deploy` + seed ครั้งแรก) → ไม่ต้องทำมือ
