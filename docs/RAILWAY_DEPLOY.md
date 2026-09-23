# Railway Deploy Runbook — stream-tip-system

คู่มือ deploy แอปนี้ขึ้น **Railway** (Next.js + PostgreSQL) แบบ production
**รอบนี้ใช้ Stripe Test Mode เท่านั้น** — ยังไม่ต้องเปลี่ยนเป็น Live Mode

> ⚠️ กฎความปลอดภัย (ห้ามละเมิด)
> - ห้าม commit `.env`, Stripe secret key, webhook secret, รหัสผ่าน DB ใด ๆ ขึ้น Git
>   (`.gitignore` มี `.env*` กันไว้แล้ว — ยกเว้น `.env.example` ที่เป็น template)
> - ห้าม hard-code secret ในโค้ด — ใช้ environment variables เท่านั้น
> - ห้ามตั้งค่า secret ของ Stripe Live ( `sk_live_...` ) จนกว่าจะตรวจ production รอบนี้เสร็จ

---

## 1) สิ่งที่โปรเจกต์เตรียมไว้ให้แล้ว

| ไฟล์ | หน้าที่ |
|---|---|
| `railway.json` | config-as-code: builder NIXPACKS · build `npm run build` · start `npm run start` · pre-deploy `npx prisma migrate deploy` · healthcheck `/api/health` |
| `prisma/migrations/20260923060000_init/` | migration เริ่มต้น (สร้างตารางครบจาก schema.prisma) — ใช้กับ DB เปล่าของ Railway |
| `src/app/api/health/route.ts` | healthcheck (ตอบ 200 เสมอเมื่อแอปทำงาน + บอกสถานะ DB) |
| `package.json` | `start` = `next start` (อ่าน `PORT` ของแพลตฟอร์ม) · `postinstall` = `prisma generate` · `typecheck` · `db:deploy` · `db:status` |

**พฤติกรรมของพอร์ต**
- Railway: ฉีด `PORT` ให้เอง → `next start` อ่านค่านั้น (ห้าม hard-code / ห้ามตั้ง `PORT` เองใน Railway)
- ในเครื่อง: `npm run dev` = 3300 · ถ้าต้องการทดสอบ production ในเครื่อง ใช้ `npm start -- -p 3300`
  (Next CLI อ่าน `PORT` จาก environment ไม่ได้อ่านจากไฟล์ `.env`)

---

## 2) Environment Variables ที่ Railway ต้องตั้ง

ตั้งที่ **Service → Variables** (ตัวที่ผูกกับ repo แอป ไม่ใช่ตัว Postgres)
🔒 ตารางนี้แสดง **ชื่อตัวแปรเท่านั้น** — ค่าจริงให้คัดลอกจากแหล่งที่ระบุ

| ชื่อตัวแปร | จำเป็น | แหล่งที่มาของค่า / หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | ✅ | เพิ่มเป็น **Reference Variable** → เลือก `DATABASE_URL` ของ service Postgres (จะได้ค่าเป็น `${{Postgres.DATABASE_URL}}`) |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://<domain ที่ Railway สร้างให้>` (ตัวเดียวกับข้อ 4) — ใช้ทำ success/cancel URL ของ Stripe ⚠️ ถูก inline ตอน build → ต้องตั้ง "ก่อน" build รอบแรก |
| `ADMIN_TOKEN` | ✅ | สุ่มเอง ยาว ≥ 16 ตัวอักษร (ห้ามใช้ซ้ำกับ OVERLAY_TOKEN) |
| `OVERLAY_TOKEN` | ✅ | สุ่มเอง ยาว ≥ 16 ตัวอักษร (คนละค่ากับ ADMIN_TOKEN) |
| `NODE_ENV` | ✅ | `production` |
| `STRIPE_SECRET_KEY` | ✅ | Stripe Dashboard → Developers → API keys (**Test Mode**, `sk_test_...`) ของบัญชีที่ใช้จ่ายเงิน |
| `STRIPE_WEBHOOK_SECRET` | ✅ | จาก webhook endpoint ที่ตั้งในข้อ 5 (`whsec_...` ของ endpoint นั้น) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ⭕ (ไม่บังคับ) | `pk_test_...` — ยังไม่มีโค้ดใช้ แต่ใส่ไว้ได้ |
| `DEFAULT_CURRENCY` | ⭕ | ค่าเริ่มต้น `THB` |
| `PAYMENT_PROVIDER` | ⭕ | ค่าเริ่มต้น `stripe` |
| `PORT` | ❌ **ห้ามตั้ง** | Railway ฉีดให้เอง ถ้าตั้งทับจะเสี่ยง routing ผิดพอร์ต |

> `ADMIN_TOKEN` / `OVERLAY_TOKEN` ต้องยาว ≥ 16 ตัว ไม่งั้นแอปจะ throw ตอนบูต (zod validation ใน `src/lib/env.ts`)

---

## 3) Checklist ก่อน push ขึ้น Git

```bash
git status                     # ตรวจว่ามีไฟล์ไหนจะถูก commit
git check-ignore -v .env       # ต้องขึ้นว่า .gitignore กันไว้ (ห้ามให้ .env หลุด)
```

- ✅ commit ได้: โค้ดใน `src/`, `prisma/` (รวม `migrations/`), `docs/`, `scripts/`, `railway.json`, `package.json`, `package-lock.json`, `.env.example`, `Dockerfile`, `docker-compose.yml`
- ❌ ห้าม commit: `.env`, `*.pem`, ไฟล์ log, `.next/`, `node_modules/`
- ตรวจซ้ำก่อน push: `git status --porcelain | findstr /i "env pem"` ต้องไม่ขึ้นไฟล์ `.env` (ยกเว้น `.env.example`)

---

## 4) ขั้นตอนใน Railway Dashboard (ทำเอง)

1. **สร้าง project** → `New Project` → `Deploy from GitHub repo` → เลือก repo นี้
   - Railway จะอ่าน `railway.json` และใช้ builder = NIXPACKS
   - ⚠️ repo นี้มี `Dockerfile` ที่ root — ถ้าไม่ใส่ `railway.json` Railway จะ auto-detect แล้วใช้ Docker แทน (เราบังคับ Nixpacks ไว้แล้ว)
2. **เพิ่ม PostgreSQL**: ใน project canvas → `+ New` → `Database` → `PostgreSQL`
3. **ผูก DB กับแอป**: ที่ service แอป → `Variables` → `Add Reference Variable` → เลือก `DATABASE_URL` ของ Postgres
4. **ใส่ Variables ที่เหลือ** ตามตารางข้อ 2 (รวม `NEXT_PUBLIC_APP_URL` เป็น domain จากข้อ 5 — ถ้ายังไม่มี domain ให้ใส่ค่าชั่วคราวก่อน แล้วอัปเดต + redeploy อีกครั้ง)
5. **สร้าง public domain**: service แอป → `Settings` → `Networking` → `Generate Domain`
   - ได้ URL อย่าง `https://<name>.up.railway.app` → นำไปใส่ `NEXT_PUBLIC_APP_URL` แล้ว redeploy
6. **ตรวจ pre-deploy command**: `Settings → Deploy → Pre-deploy Command` ต้องเป็น `npx prisma migrate deploy`
   (มาจาก `railway.json` — แก้ในหน้าเว็บจะเขียนทับ config-as-code)
7. **Deploy** → ดู log: ต้องเห็น `prisma migrate deploy` ผ่านก่อน แล้ว `npm run start` ขึ้น
8. **Seed ข้อมูลเริ่มต้นครั้งเดียว** (สร้าง SystemSetting + blocklist):
   - เปิด Shell/Terminal ของ service แล้วรัน `npm run db:seed`
   - หรือรันในเครื่องโดยชี้ `DATABASE_URL` ไปที่ Public URL ของ Railway
   - (script เป็น idempotent — รันซ้ำจะข้ามถ้ามีอยู่แล้ว)

---

## 5) Stripe Webhook สำหรับ Production (Test Mode)

- URL ของ endpoint: `https://<domain>/api/webhooks/payment`
- สร้างที่ Stripe Dashboard → Developers → Webhooks → **Add endpoint** (Test Mode)
  - Events ที่ต้องเลือก (ตรงกับที่โค้ดรองรับ):
    - `checkout.session.completed`
    - `checkout.session.async_payment_succeeded`
    - `checkout.session.async_payment_failed`
    - `checkout.session.expired`
  - กด **Reveal** signing secret → คัดลอกไปใส่ Railway Variable `STRIPE_WEBHOOK_SECRET`
- ⚠️ ต้องเป็น**บัญชีเดียวกับ** `STRIPE_SECRET_KEY` (บัญชีที่ผู้ชมจ่ายเงิน) — ถ้าคนละบัญชี event จะไม่ถึงแอป
  (อาการหลอก: `stripe trigger` ผ่าน แต่ donation จริงเงียบ)
- ⚠️ หลังแก้ secret → **redeploy** เพื่อให้แอปอ่านค่าใหม่ (env ถูกอ่านตอนบูตเท่านั้น)
- ฝั่งแอปตรวจลายเซ็นจาก **raw body** เสมอ (`req.arrayBuffer()` + `stripe.webhooks.constructEvent`)
  → ห้ามเปลี่ยนเป็น `req.json()` และห้ามวาง proxy ที่อ่าน/แก้ body ระหว่างทาง
- การทดสอบในเครื่องยังใช้ `scripts/start-stripe-listen.ps1` ได้ตามปกติ (แต่จะ forward ไป localhost ไม่ใช่ production)

---

## 6) ตรวจหลัง deploy (Checklist)

| ตรวจ | วิธี | คาดหวัง |
|---|---|---|
| Health | `curl https://<domain>/api/health` | `200` + `{"ok":true,"database":"up",...}` |
| Tip form | เปิด `https://<domain>/` | หน้าเว็บโหลดผ่าน HTTPS |
| Admin | `/admin/login` ด้วย `ADMIN_TOKEN` | เข้า Dashboard ได้ |
| Migration | Railway log ตอน deploy | `All migrations have been successfully applied` |
| Alert | เปิด `/overlay?token=<OVERLAY_TOKEN>` ค้างไว้ → กด "ส่ง Test Alert" | การ์ดเด้งบน overlay |
| SSE | เปิด overlay ค้าง 1–2 นาที | ไม่หลุด (มี heartbeat ทุก 15 วินาที) |
| Webhook | จ่ายด้วยบัตรทดสอบ `4242 4242 4242 4242` แล้วดู Stripe → Webhooks | `200` และมี alert เด้ง |

---

## 7) Troubleshooting

| อาการ | สาเหตุที่พบบ่อย | วิธีแก้ |
|---|---|---|
| `Application failed to respond` | แอปไม่ฟังพอร์ตที่ Railway ให้ (hard-code พอร์ต) | ตรวจว่า start = `npm start` (ไม่มี `-p`) และห้ามตั้ง `PORT` เอง |
| Healthcheck ไม่ผ่าน | env ไม่ครบ → zod throw ตอนบูต | ดู log แล้วเพิ่มตัวแปรให้ครบตามข้อ 2 |
| `prisma migrate deploy` ล้ม | DB ปลายทางมีตารางอยู่แล้วแต่ไม่มีประวัติ migration | อย่าใช้ `db push` กับ production; ถ้ามีข้อมูลเดิมให้ `prisma migrate resolve --applied <name>` |
| เปิดเว็บแล้ว 500 ทุกหน้า | Prisma ต่อ DB ไม่ได้ | ตรวจ `DATABASE_URL` ว่าเป็น Reference Variable และ Postgres healthy |
| Postgres SSL error | ใช้ URL public (`DATABASE_PUBLIC_URL`) | ใช้ `${{Postgres.DATABASE_URL}}` (internal network) |
| Alert ไม่เด้งทั้งที่จ่ายแล้ว | secret ไม่ตรง / คนละบัญชี Stripe / OBS ชี้ URL เก่า | ดู log ของ Stripe endpoint (200 vs 400) + ตรวจ `NEXT_PUBLIC_APP_URL` |
| ต้องการสเกล > 1 replica | SSE registry + rate limit เป็น in-memory | ยังไม่รองรับ — คง 1 replica (ต้องใช้ Redis pub/sub ถ้าจะสเกล) |

---

## 8) หมายเหตุ

- `Dockerfile` + `docker-compose.yml` ยังใช้ได้ (Dockerfile ปรับให้อ่าน `PORT` จากแพลตฟอร์มแล้ว)
  ถ้าต้องการ deploy ด้วย Docker บน Railway → แก้ `railway.json` เป็น `"builder": "DOCKERFILE"`
- เสียง alert: วางไฟล์ MP3 ที่ `public/alerts/alert.mp3` (ตอนนี้ยังไม่มี → เสียง 404 แต่ TTS ยังทำงาน)
- **ยังไม่ต้องทำ Stripe Live**: เมื่อตรวจ production รอบนี้ผ่านแล้ว ค่อยเปลี่ยนเป็นคีย์ Live + สร้าง endpoint Live
  + อัปเดต `STRIPE_WEBHOOK_SECRET` (ไม่ต้องแก้โค้ด)

