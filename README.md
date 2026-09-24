# Stream Tip System

ระบบ Tip/Donate ส่วนตัวสำหรับสตรีมเมอร์ — ออกแบบเพื่อใช้คนเดียว ไม่ใช่แพลตฟอร์มสาธารณะ

**Stack**: Next.js 16.3.5 (App Router) · React 19.2.8 · TypeScript 5 · PostgreSQL 16 · Prisma 6.19.3 · Tailwind CSS 4 · Stripe 22.6.2 (Test Mode) · Docker

---

## ✨ Features

- 🎁 **Public Tip Form** — ผู้ชมกรอกชื่อ จำนวนเงิน และข้อความ รองรับ Anonymous
- 💳 **Stripe Hosted Checkout** — ไม่เก็บข้อมูลบัตรเอง
- 🔒 **Webhook Signature Verification** — ยืนยันการชำระเงินจาก Stripe โดยตรง
- 🔁 **Idempotency Protection** — ป้องกัน Webhook ซ้ำด้วย DB Unique Constraint
- 📺 **OBS Browser Source Alert** — แสดงแจ้งเตือนบน Stream ผ่าน Server-Sent Events
- 🏆 **Top Donate** — ผู้สนับสนุนยอดสะสมสูงสุด 3 อันดับ ในรูปแบบ **ตารางไม่มีกรอบ** พร้อมหัวข้อ "Top Donate": `01 · ชื่อ · ฿ยอด` · **ตัวอักษรสไตล์เดียวกับการ์ด Last Follow เป๊ะ** (Montserrat 300/500/600 self-host + Noto Sans Thai fallback · น้ำหนัก 600) แต่ **ตัวใหญ่กว่า ~2 เท่า อ่านจากระยะไกล** · **พื้นหลังใสสนิท (ไม่มี plate/ไม่มีกรอบ)** · **ชื่อเป็นสีดำแบบไม่มีเงาเลย** · สีเลขอันดับ ทอง/เงิน/ทองแดง · **ควันเปิดไว้แบบเบา ๆ** (ปิดด้วย `?nosmoke=1`) · นับเฉพาะ **ยอดจริง** (ไม่รวมยอดทดสอบ) · 匿名 → "ไม่ระบุชื่อ"
  - หน้า: `/podium?token=<OVERLAY_TOKEN>` · ข้อมูลจาก `/api/overlay/top-donors` (อ่านอย่างเดียว · token เดิม)
  - **สลับกับ Last Follow อัตโนมัติทุก 15 วินาที** ที่ตำแหน่งเดียวกัน ผ่าน `/donate` ของระบบ Overlay เก่า (Last Follow หน้าตาเดิม 100%) · ปรับขนาด/ควัน/สี จากพารามิเตอร์ท้าย URL เดียวได้
- 🔊 **TTS (Text-to-Speech)** — อ่านข้อความบริจาคออกเสียงผ่าน Web Speech API (อ่านเมื่อยอด ≥ `minAmountForTTS` — ค่าเริ่มต้น ฿10)
  - **ตัวอ่านหลัก = Edge `/overlay/voice`** (เสียงหญิงไทยธรรมชาติ) — หน้าต่าง overlay ของ OBS จะ **ไม่อ่านซ้ำเอง** โดยอัตโนมัติ (ผ่าน SSE event `presence`)
  - ถ้าหน้าต่าง Edge ไม่ได้เปิด (หรือไม่มีเสียงหญิง) ระบบจะ **fallback** ไปใช้เสียงที่ OBS มี (`Pattara`) ⇒ การ์ด/คิว **ไม่พัง** เพราะปัญหาเสียง
  - ควบคุมผ่าน URL: `&tts=0` ปิด · `&tts=local` บังคับให้หน้าต่างนั้นอ่านเอง · `&ttsvoice=` `&ttsrate=` `&ttspitch=` · `&ttsdiag=1` `&alertdiag=1` · `&ttsselftest=1` (ที่หน้า voice)
- 🛡️ **Content Filter** — กรองคำหยาบ / XSS / จำกัดความยาวข้อความ
- 🚨 **Emergency Kill Switch** — ปิด Alert และ TTS ทันทีจาก Dashboard
- 📊 **Admin Dashboard** — ดูประวัติทิป ทดสอบ Alert จัดการคิวและ Blocklist

---

## 🚀 การติดตั้งและรันในเครื่อง

### 1. ข้อกำหนดเบื้องต้น

- [Node.js 20.9+](https://nodejs.org) (Next.js 16 ต้องการ Node ≥ 20.9)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (สำหรับ PostgreSQL)
- [Stripe Account](https://stripe.com) (ใช้ Test Mode ฟรี)

### 2. Clone และติดตั้ง

```bash
git clone <repo-url>
cd stream-tip-system
npm install
```

### 3. ตั้งค่า Environment Variables

```bash
cp .env.example .env
```

แก้ไขค่าใน `.env`:

```env
# ห้ามใช้ค่า default ใน production
ADMIN_TOKEN=your_strong_admin_token_here
OVERLAY_TOKEN=your_strong_overlay_token_here

# นำค่ามาจาก Stripe Dashboard → Developers → API keys
STRIPE_SECRET_KEY=sk_test_51...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. รัน PostgreSQL ด้วย Docker

```bash
# รัน PostgreSQL ด้วย Docker (เฉพาะ db service)
docker-compose up -d db

# รอจนกว่า container พร้อม แล้ว migrate schema
npx prisma db push

# Seed ค่าเริ่มต้น (Blocklist, Settings)
npm run db:seed
```

### 5. รันในโหมด Development

```bash
npm run dev
```

เปิด [http://localhost:3300](http://localhost:3300)

---

## 🌐 URL ของแต่ละหน้า

| หน้า | URL | คำอธิบาย |
|------|-----|-----------|
| Tip Form | `http://localhost:3300/` | สำหรับผู้ชม |
| OBS Overlay | `http://localhost:3300/overlay?token=YOUR_OVERLAY_TOKEN` | OBS Browser Source |
| Top Donate Podium | `http://localhost:3300/podium?token=YOUR_OVERLAY_TOKEN` | ผู้สนับสนุนยอดสะสมสูงสุด 3 อันดับ (`&podiumdiag=1` เพื่อวินิจฉัย) |
| Donate + Last Follow (สลับอัตโนมัติ) | `http://localhost:3000/donate?token=YOUR_OVERLAY_TOKEN` | ตัวสลับของระบบ Overlay เก่า: Last Follow ⇄ Podium ทุก 15 วิ |
| Admin Login | `http://localhost:3300/admin/login` | เข้าสู่ระบบ Admin |
| Admin Dashboard | `http://localhost:3300/admin` | จัดการระบบ |

---

## ⚠️ พอร์ต 3000 ถูกใช้โดยระบบ Overlay เก่า (poomes-stream-system)

เครื่องนี้รัน 2 ระบบคู่กัน — **คนละพอร์ต** เพื่อไม่ให้แย่งพอร์ตกัน:

| ระบบ | พอร์ต | URL ที่ใช้ใน OBS |
|------|-------|------------------|
| `poomes-stream-system` (Alert / Latest / Goal / Cam / Twitch follow) | `3000` | `http://localhost:3000/alert?motion=1` |
| `stream-tip-system` (ระบบ Tip/Donate นี้) | `3300` | `http://localhost:3300/overlay?token=YOUR_OVERLAY_TOKEN` |

- ถ้าแก้พอร์ตของระบบนี้ ต้องแก้ **พร้อมกัน 3 ที่**: `package.json` (`next dev -p 3300`) · `.env` (`NEXT_PUBLIC_APP_URL`) · คำสั่ง Stripe CLI (ใช้ `scripts\start-stripe-listen.ps1` ที่อ่านพอร์ตจาก `.env` เอง)
- `npm start` (production) **ไม่ผูกพอร์ต** — ใช้ค่า `PORT` ของแพลตฟอร์ม (Railway ฉีดให้) → ถ้าจะรัน production ในเครื่องให้ใช้ `npm start -- -p 3300`
- ถ้ารันระบบนี้ที่พอร์ต `3000` อีกครั้ง จะไปชนกับระบบเก่า → OBS source ของระบบเก่าจะได้ **404** (มี Next.js ตอบแทนที่) และ OBS ไม่มีอะไรขึ้น

---

## 📺 ตั้งค่า OBS Browser Source

1. เปิด OBS → **Sources** → **+** → **Browser**
2. ตั้งค่า:
   - **URL**: `http://localhost:3300/overlay?token=YOUR_OVERLAY_TOKEN`
   - **Width**: `1920` | **Height**: `1080`
   - ✅ **Shutdown source when not visible**
   - ✅ **Refresh browser when scene becomes active**
3. **Custom CSS**:
   ```css
   body { background-color: rgba(0,0,0,0); margin: 0; }
   ```
4. คลิก **Chroma Key** → เลือก สี **Green** (ถ้าต้องการ transparent จริง ๆ ให้ใช้ Custom CSS แทน)

> **หมายเหตุ**: OBS Browser Source จะ Reconnect อัตโนมัติเมื่อตัดการเชื่อมต่อ

---

## 💳 ตั้งค่า Stripe Webhook สำหรับ Local Development

ใช้ [Stripe CLI](https://stripe.com/docs/stripe-cli) เพื่อ Forward Webhook ไปยัง localhost:

```bash
# ติดตั้ง Stripe CLI
# Windows: winget install Stripe.StripeCLI

# Login
stripe login

# Forward Webhook ไปยัง local server
stripe listen --forward-to http://localhost:3300/api/webhooks/payment

# Stripe CLI จะแสดง whsec_... ให้ copy ใส่ .env STRIPE_WEBHOOK_SECRET
```

> ⚠️ **สำคัญมาก**: `whsec_...` ที่ CLI พิมพ์ตอนเริ่ม (`Ready! ... Your webhook signing secret is whsec_...`)
> ต้องตรงกับ `.env` → `STRIPE_WEBHOOK_SECRET` **เสมอ** ไม่เช่นนั้น:
> - webhook จะถูกปฏิเสธเป็น **400 Invalid signature** → ผู้ชมจ่ายเงินสำเร็จ แต่ **ไม่มี Alert ขึ้นบน OBS เลย** (อาการเงียบสนิท ไม่มี error บนหน้าเว็บ)
> - ตรวจได้จากหน้าต่าง `stripe listen` ว่าขึ้น `[400] POST .../api/webhooks/payment`
> - แก้ `STRIPE_WEBHOOK_SECRET` แล้วต้อง **รีสตาร์ท** `npm run dev` เสมอ (env ถูกอ่านตอนสตาร์ทเท่านั้น)
> - ค่า secret ของ CLI **ไม่ใช่**ค่าเดียวกับ `whsec_` ใน Stripe Dashboard → ต้องใช้ค่าที่ CLI พิมพ์เท่านั้น

> 🚨 **กับดักที่หลอกที่สุด — CLI ต้องอยู่ "บัญชีเดียวกัน" กับ `STRIPE_SECRET_KEY` ใน `.env`**
> - ถ้าคนละบัญชี: `stripe trigger` จะขึ้นสำเร็จและแอปตอบ `[200]` (เพราะ event เกิดในบัญชีของ CLI)
>   แต่ **donation จริงของผู้ชมไม่ขึ้นบน OBS เลย** เพราะ session/การจ่ายเกิดในบัญชีของ API key → CLI ไม่มีทางได้รับ event นั้น
> - วิธีกันถาวร: เปิด CLI ด้วย `powershell -File scripts\start-stripe-listen.ps1` (สคริปต์จะส่ง `--api-key` จาก `.env` ให้เอง)
> - ตรวจบัญชีของ key: `curl https://api.stripe.com/v1/account -u <STRIPE_SECRET_KEY>:` → ค่า `id` ต้องเป็นบัญชีเดียวกันกับที่ใช้จ่ายเงิน
> - ถ้า CLI อยู่ผิดบัญชีและมี event หลุดไปแล้ว: ดึง event นั้นจาก Stripe แล้วยิงซ้ำเข้า webhook พร้อมลายเซ็น (idempotency กันซ้ำด้วย `eventId` ให้อยู่แล้ว)

### ทดสอบ Webhook ด้วย Stripe CLI

```bash
# จำลองการชำระเงินสำเร็จ
stripe trigger checkout.session.completed
```

> 💡 **สคริปต์ช่วย (แนะนำ)**
> - เปิด forwarder พร้อมเช็ค secret: `powershell -ExecutionPolicy Bypass -File scripts\start-stripe-listen.ps1`
>   (อ่านพอร์ตจาก `.env` เอง จึงไม่ต้องพิมพ์ `3000`/`3300` มือ และเช็ค `STRIPE_WEBHOOK_SECRET` ให้ก่อนเริ่ม)
> - เช็ค/ซ่อม secret อย่างเดียว: `powershell -ExecutionPolicy Bypass -File scripts\sync-stripe-secret.ps1 [-NoWrite]`
>   (ถ้าแก้ `.env` ให้ **รีสตาร์ท `npm run dev`** ทุกครั้ง)

---

## 🐳 รันทั้งระบบด้วย Docker (Production Mode)

```bash
# สร้าง .env จาก .env.example แล้วใส่ค่าจริงก่อน
cp .env.example .env

# Build และรัน
docker-compose up --build

# Migrate schema ครั้งแรก
docker-compose exec app npx prisma db push

# Seed ข้อมูลเริ่มต้น
docker-compose exec app npm run db:seed
```

---

## 🚂 Deploy บน Railway (Production)

🔁 **เช็คก่อนไลฟ์ทุกครั้ง:** [docs/STREAM_DAY_CHECKLIST.md](docs/STREAM_DAY_CHECKLIST.md) (เปิด/เช็คอะไรบ้างหลังรีสตาร์ทเครื่อง)

คู่มือเต็มอยู่ที่ **[docs/RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md)** — สรุปย่อ:

1. push repo ขึ้น GitHub (ไฟล์ `.env` ถูก ignore ไว้แล้ว — ห้าม commit ค่าจริง)
2. Railway → `New Project` → `Deploy from GitHub repo` → เลือก repo (Railway อ่าน `railway.json` → ใช้ **Dockerfile + Node 24 + npm 11**)
3. `+ New` → `Database` → `PostgreSQL` → ที่ service แอปเพิ่ม **Reference Variable** `DATABASE_URL`
4. ตั้ง Variables: `DATABASE_URL` (reference) · `NEXT_PUBLIC_APP_URL` · `ADMIN_TOKEN` · `OVERLAY_TOKEN` · `NODE_ENV=production` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET`
   ⚠️ **ห้ามตั้ง `PORT`** (Railway จัดการเอง) · `NEXT_PUBLIC_*` ต้องตั้งก่อน build รอบแรก
5. `Settings → Networking → Generate Domain` → ได้ HTTPS URL → อัปเดต `NEXT_PUBLIC_APP_URL` แล้ว redeploy
6. Migration รันอัตโนมัติก่อน deploy (`preDeployCommand: npx prisma migrate deploy` จาก `railway.json`)
7. Seed ข้อมูลเริ่มต้นครั้งเดียว: `npm run db:seed`
8. Stripe (Test Mode) → Developers → Webhooks → **Add endpoint** ที่ `https://<domain>/api/webhooks/payment` → เอา `whsec_...` ใส่ Variable แล้ว redeploy

ตรวจสุขภาพระบบ: `curl https://<domain>/api/health` → ต้องได้ `{"ok":true,"database":"up"}`

> ⚠️ รอบนี้ใช้ Stripe **Test Mode** เท่านั้น — ยังไม่ต้องเปลี่ยนเป็น Live Mode

---

## 🔐 Security Notes

- **ห้าม hard-code** Token ใดๆ ในโค้ด — ใช้ `.env` เท่านั้น
- **ADMIN_TOKEN** และ **OVERLAY_TOKEN** ต้องเป็นคนละค่า และยาวอย่างน้อย 16 ตัวอักษร
- Webhook ตรวจสอบ Cryptographic Signature ของ Stripe ทุกครั้ง — ไม่เชื่อข้อมูลจาก Client
- Alert จะแสดงบน OBS ก็ต่อเมื่อ Webhook ยืนยันว่าชำระเงินสำเร็จแล้วเท่านั้น

---

## 📁 โครงสร้างโปรเจกต์

```
stream-tip-system/
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── seed.ts            # ข้อมูลเริ่มต้น
├── public/
│   └── alerts/            # วางไฟล์เสียง alert.mp3 ที่นี่
├── src/
│   ├── app/
│   │   ├── page.tsx           # หน้า Tip Form
│   │   ├── success/           # หน้าหลังชำระเงินสำเร็จ
│   │   ├── cancel/            # หน้าหลังยกเลิก
│   │   ├── overlay/           # OBS Browser Source
│   │   ├── admin/             # Admin Dashboard
│   │   └── api/               # API Routes
│   ├── components/
│   │   ├── tip/               # TipForm
│   │   ├── overlay/           # OverlayClient (SSE + TTS)
│   │   └── admin/             # AdminDashboard
│   ├── lib/
│   │   ├── db.ts              # Prisma Client
│   │   ├── env.ts             # Zod env validator
│   │   ├── auth.ts            # Token verification
│   │   ├── filter.ts          # XSS + Blocklist
│   │   ├── rate-limit.ts      # Rate limiting
│   │   ├── sse.ts             # SSE broadcaster
│   │   └── payment/           # Payment Provider Adapter
│   └── types/                 # TypeScript interfaces
├── .env.example
├── docker-compose.yml
├── Dockerfile
└── README.md
```

---

## 🔧 Scripts

```bash
npm run dev          # รัน development server
npm run build        # Build production
npm run db:push      # Sync schema กับ DB (ไม่มี migration history)
npm run db:seed      # Seed ข้อมูลเริ่มต้น
npm run db:studio    # เปิด Prisma Studio (DB GUI)
```

### 🧰 สคริปต์ช่วยงาน (โฟลเดอร์ `scripts/`)

| สคริปต์ | ใช้ทำอะไร |
|---|---|
| `set-min-tts.ps1` | ดู/ตั้งค่า **เกณฑ์อ่านเสียง** (`minAmountForTTS`) ของระบบที่ deploy อยู่ผ่าน Admin API — ไม่ต้องเปิดเบราว์เซอร์ (`-CheckOnly` = ดูอย่างเดียว · `-Local` = ยิงเครื่องตัวเอง) |
| `check-thai-voices.ps1` | ตรวจ **เสียงไทยที่ Windows มี** + บอกว่าแอปจะเลือกเสียงไหน (คะแนนสูตรเดียวกับ `src/lib/tts/voice.ts`) · `-Simulate "<ชื่อเสียง>"` = ลองก่อนติดตั้ง · exit `0`=มีเสียงหญิง / `2`=มีแต่ชาย / `1`=ไม่มีเสียงไทย |
| `top-donors-preview.ts` | พิมพ์ **Top Donors (ยอดสะสม)** จาก DB จริงด้วยสูตรเดียวกับ API · ค่าเริ่มต้นนับเฉพาะยอดจริง (`--include-test` = รวมยอดทดสอบสำหรับ dev) |
| `start-stripe-listen.ps1` | เปิด Stripe CLI forward webhook ไป localhost (ดึงพอร์ต/คีย์จาก `.env`) |
| `sync-stripe-secret.ps1` | ซิงก์ `STRIPE_WEBHOOK_SECRET` ใน `.env` ให้ตรงกับ Stripe CLI |
| `e2e/*.ts` | ชุดทดสอบ E2E (ดู [docs/E2E_RUNBOOK.md](docs/E2E_RUNBOOK.md)) |

---

## ⚠️ เพิ่มไฟล์เสียง Alert

วางไฟล์เสียงที่ต้องการในชื่อ `public/alerts/alert.mp3`

ดาวน์โหลดได้ฟรีจาก:
- [freesound.org](https://freesound.org) — ค้นหา "donation alert"
- [pixabay.com/sound-effects](https://pixabay.com/sound-effects/) — ค้นหา "notification chime"
