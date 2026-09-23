# E2E Test Runbook — Stream Tip System

เอกสารนี้ใช้สำหรับ **ทดสอบระบบแบบ End-to-End บนเครื่อง Local** เท่านั้น
(Docker + PostgreSQL + Stripe Test Mode + OBS Overlay)

> **ข้อตกลงสำคัญ**
> - ❌ ห้ามแก้ source code ระหว่างทดสอบ — ถ้าพบ error ให้แก้ **เฉพาะจุดที่ทดสอบแล้วพิสูจน์ว่าเป็น bug**
> - ❌ ห้ามเปลี่ยน architecture / payment provider / schema
> - ✅ ใช้ Stripe **Test Mode** และ PostgreSQL ใน Docker เท่านั้น (ห้ามใช้ข้อมูลจริง)
> - ✅ ข้อมูลที่สคริปต์สร้างจะใช้ prefix `cs_test_e2e_` (PaymentTransaction.providerTxId) และ `evt_e2e_` (WebhookEventLog.eventId) และลบได้ด้วย `scripts/e2e/99-cleanup.ts`
> - ❌ ห้ามรัน `prisma migrate reset` หรือ `docker compose down -v` ถ้ามีข้อมูลที่ต้องการเก็บ
> - ไฟล์ state ของการทดสอบ: `%TEMP%\stream-tip-e2e-state.json` (ไม่ทิ้งไฟล์ในโปรเจกต์)

---

## 0) สถานะความพร้อมของเครื่องนี้ (Blocker ที่ต้องแก้ก่อน — ทำครั้งเดียว)

ผลตรวจล่าสุดบนเครื่องนี้:

| รายการ | สถานะ |
|---|---|
| Docker CLI / Compose | ✅ พร้อม (`Docker version 29.5.3`, `Compose v5.1.4`) |
| Docker Engine (Linux) | ❌ ไม่ทำงาน — ต้องเปิด Docker Desktop |
| WSL2 | ❌ `WSL2 is not supported with your current machine configuration` (ยังไม่เปิด "Virtual Machine Platform") |
| virtualization ใน BIOS (VT-x) | ✅ เปิดอยู่แล้ว (`VirtualizationFirmwareEnabled = True`) |
| PostgreSQL binary/service ในเครื่อง | ❌ ไม่มี (มีแค่ data directory เปล่า) → ต้องใช้ Docker |

**วิธีแก้ (ต้องทำเอง, ใช้สิทธิ์ Admin + รีสตาร์ทเครื่อง 1 ครั้ง):**

```powershell
# 1) เปิด PowerShell as Administrator
wsl --install --no-distribution
#    หรือ
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

# 2) รีสตาร์ทเครื่อง (จำเป็น)

# 3) เปิด Docker Desktop แล้วรอจนสถานะเป็น "Engine running"
docker info --format "{{.ServerVersion}}"   # ต้องได้เลข version (ไม่ error 500/pipe not found)
```

ตรวจซ้ำ: `wsl --status` ต้องไม่ขึ้นข้อความ `WSL2 is not supported ...` อีก

---

## 1) สคริปต์ที่เตรียมไว้ (`scripts/e2e/`)

| ไฟล์ | ใช้กับขั้น | คำสั่ง |
|---|---|---|
| `_shared.ts` | (helper) | ไม่รันตรง ๆ |
| `01-check-readiness.ts` | 1, 2, 3, 6, 7 | `npx tsx scripts/e2e/01-check-readiness.ts` |
| `02-verify-schema-seed.ts` | 4, 5 | `npx tsx scripts/e2e/02-verify-schema-seed.ts` |
| `03-prepare-payment.ts` | 9 (เตรียมข้อมูล) | `npx tsx scripts/e2e/03-prepare-payment.ts --amount 100` |
| `04-send-webhook.ts` | 9, 10 | `npx tsx scripts/e2e/04-send-webhook.ts [--times 2] [--mode ...]` |
| `05-verify-db.ts` | 8, 10, 11, 14 | `npx tsx scripts/e2e/05-verify-db.ts [--expect-ack] [--expect-no-alert]` |
| `06-sse-client.ts` | 12, 13, 14 | `npx tsx scripts/e2e/06-sse-client.ts [--ack] [--no-token] [--seconds 60]` |
| `07-admin-api.ts` | 15, 16 | `npx tsx scripts/e2e/07-admin-api.ts` |
| `99-cleanup.ts` | 18 | `npx tsx scripts/e2e/99-cleanup.ts [--force-unmute]` |

> สคริปต์ทั้งหมดอ่านค่าจาก `.env` เอง, ไม่แก้ไฟล์ในโปรเจกต์ และไม่แตะข้อมูลจริง (มี prefix guard)

---

## ขั้นตอนที่ 1 — ตรวจ Docker Desktop / Docker Engine

```powershell
docker --version
docker compose version
docker info --format "{{.ServerVersion}}"     # ต้องได้ตัวเลข version
npx tsx scripts/e2e/01-check-readiness.ts     # ตรวจครบ: engine, container, port, DB, Stripe env
```

**Expected**
- `docker info` คืนค่า version (ไม่ error `pipe not found` / `500 Internal Server Error`)
- สคริปต์ `01-...` แสดง `[PASS] Docker Engine ทำงาน`

**ถ้าไม่ผ่าน**: เปิด Docker Desktop → รอจน "Engine running" → ถ้ายังไม่ขึ้น ให้กลับไปทำข้อ 0 (WSL2 / Virtual Machine Platform)

---

## ขั้นตอนที่ 2 — เปิด/ตรวจ PostgreSQL container

```powershell
docker compose up -d db
docker compose ps
```

**Expected**: `stream_tip_postgres` … `Up (healthy)` และมี mapping `0.0.0.0:5432->5432/tcp`
(สคริปต์ `01-...` จะตรวจ container + พอร์ต 5432 ให้อัตโนมัติ)

**ถ้าไม่ผ่าน**: `docker compose logs db` (ดูสาเหตุ) → `docker compose up -d db` ซ้ำ
⚠️ container ใช้ volume `postgres_data` — **ห้าม** `docker compose down -v` ถ้าไม่อยากลบข้อมูล

---

## ขั้นตอนที่ 3 — ตรวจ `DATABASE_URL`

ค่าปัจจุบันใน `.env` (ต้องตรงกับ `docker-compose.yml`):

```
DATABASE_URL="postgresql://postgres:<DB_PASSWORD>@localhost:5432/stream_tip_db?schema=public"
```

| ค่า | ต้องเป็น |
|---|---|
| user / password | `postgres` / `<DB_PASSWORD>` (ตรงกับ `POSTGRES_USER` / `POSTGRES_PASSWORD`) |
| database | `stream_tip_db` |
| host:port (รันบนเครื่อง) | `localhost:5432` |
| host (ใน Docker network ของ service `app`) | `db:5432` (กำหนดใน `docker-compose.yml` อยู่แล้ว — **ห้ามแก้ .env เป็น `db`** สำหรับรันบนเครื่อง) |

**Expected**: `npx tsx scripts/e2e/01-check-readiness.ts` → `[PASS] เชื่อมต่อ PostgreSQL สำเร็จ (SELECT 1)`

---

## ขั้นตอนที่ 4 — Prisma: สร้าง/อัปเดตตารางตาม schema ปัจจุบัน

โปรเจกต์นี้ **ไม่มีโฟลเดอร์ `prisma/migrations`** จึงใช้ `db push` (ตรงกับ README และ Dockerfile)

```powershell
npx prisma db push
```

**Expected**: `Your database is now in sync with your Prisma schema.` (ไม่มี error)
**ตรวจต่อ**: `npx tsx scripts/e2e/02-verify-schema-seed.ts` → `[PASS] ตาราง ... ใช้งานได้`

> ถ้าต้องการเปลี่ยนไปใช้ migration history ในอนาคต ค่อยคุยกันแยก (ไม่ทำในรอบทดสอบนี้)

---

## ขั้นตอนที่ 5 — Seed ข้อมูลเริ่มต้น

```powershell
npm run db:seed
```

**Expected** (ครั้งแรก): `Default SystemSetting created.` / (ครั้งถัดไป): `SystemSetting already exists, skipping seed.`

**ตรวจต่อ**: `npx tsx scripts/e2e/02-verify-schema-seed.ts`
- `[PASS] พบ SystemSetting id=default`
- ค่าที่ใช้ในการทดสอบ: `minTipAmount=10`, `minAmountForTTS=20`, `alertDurationSec=8`, `bannedWords` มี 11 คำ
- `[PASS] Emergency เปิดอยู่ทั้ง Alert และ TTS (พร้อมทดสอบ SSE)`

## ขั้นตอนที่ 6 — ตั้งค่า Stripe Test Mode (environment variables)

1. เข้า Stripe Dashboard → **Developers → API keys** (โหมด **Test mode**)
2. แก้ `.env`:

```env
STRIPE_SECRET_KEY=sk_test_...                    # บังคับ (ฝั่ง server)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...   # ไม่บังคับ (Hosted Checkout ไม่จำเป็นต้องใช้)
DEFAULT_CURRENCY=THB
```

3. ตรวจ: `npx tsx scripts/e2e/01-check-readiness.ts` (ส่วนที่ 6)
4. เปิดวิธีจ่ายเงินที่ต้องการใน **Dashboard → Settings → Payment methods** (โหมด Test):
   - ✅ **Card** (ปกติ Stripe เปิดให้อยู่แล้ว)
   - ✅ **PromptPay** (ต้องมี business location = Thailand และใช้สกุลเงิน THB)

> 💡 โค้ดใช้ **Dynamic Payment Methods** (ไม่ระบุ `payment_method_types` ใน Checkout Session)
> Stripe จึงเลือกวิธีจ่ายจากรายการที่เปิดใน Dashboard × ความเข้ากันได้กับสกุลเงิน/ประเทศของผู้ชม
> ถ้าไม่เปิด PromptPay ใน Dashboard → ผู้ชมจะไม่เห็นตัวเลือก PromptPay
> (ดูเหตุผลในหัวข้อ "PromptPay" ด้านล่าง)

**Expected**
- `[PASS] STRIPE_SECRET_KEY เป็น Test Mode (sk_test_)`
- ไม่มี `[WARN] ... ยังเป็นค่า placeholder` อีก

**หมายเหตุ**: ต้องมี **Stripe CLI** สำหรับขั้นที่ 8 (เครื่องนี้ยังไม่มี — คำสั่ง `stripe` ไม่พบ)

```powershell
winget install Stripe.StripeCLI
```

---

## ขั้นตอนที่ 7 — ตรวจ `STRIPE_WEBHOOK_SECRET`

| ทาง | วิธี | ใช้เมื่อ |
|---|---|---|
| A (ของจริง) | รัน `stripe listen ...` แล้ว copy `whsec_...` ที่ CLI พิมพ์ มาใส่ `.env` | ทดสอบกับ Stripe จริง (ขั้น 9 ทาง A) |
| B (offline) | ตั้งค่าเอง เช่น `STRIPE_WEBHOOK_SECRET=whsec_e2e_local_secret` | ทดสอบ webhook pipeline โดยไม่ใช้บัญชี Stripe |

ค่าปัจจุบันใน `.env` (placeholder สำหรับ dev):

```env
STRIPE_WEBHOOK_SECRET=whsec_placeholder_for_local_dev
```

> ⚠️ เมื่อเลิกทดสอบ ควรคืนค่าเดิม หรือเปลี่ยนเป็นค่าจริงของ Stripe ของคุณ
> 💡 สคริปต์ `04-send-webhook.ts` เซ็นลายเซ็นด้วยค่าที่อยู่ใน `.env` เสมอ → ใช้ได้ทั้งทาง A และ B

**Expected**: `01-check-readiness.ts` → `[PASS] STRIPE_WEBHOOK_SECRET มีรูปแบบถูกต้อง (whsec_)`

---

## ขั้นตอนที่ 8 — รัน Stripe CLI เพื่อ forward webhook ไปยัง API ท้องถิ่น

เปิดอีกหน้าต่าง (ต้องรัน app อยู่ด้วย — ดูขั้นที่ 9):

```powershell
stripe login
stripe listen --forward-to http://localhost:3300/api/webhooks/payment
```

**Expected**
- `Ready! You are using Stripe API Version [2026-08-26.dahlia] ...`
- `Your webhook signing secret is whsec_...` → นำไปใส่ `.env` (ทาง A ของขั้นที่ 7)
- เมื่อมี event จะขึ้น log เช่น `[200] POST http://localhost:3300/api/webhooks/payment`

---

## ขั้นตอนที่ 9 — ทดสอบ Payment / Webhook flow

### เตรียม

```powershell
npm run dev        # เปิด http://localhost:3300
```

### ทาง A — Stripe จริง (Test Mode)

1. เปิด `http://localhost:3300` → กรอกชื่อ/ยอด (≥ 10 บาท ตาม `minTipAmount`)/ข้อความ → กดส่ง
2. ที่หน้า Stripe Checkout ใช้บัตรทดสอบ `4242 4242 4242 4242` · วันหมดอายุอนาคต · CVC อะไรก็ได้
3. กลับมาที่ `/success`

**Expected**
- Stripe CLI (ขั้น 8) แสดง `[200] POST /api/webhooks/payment`
- หน้า `/success` แสดงผลสำเร็จ
- DB: `PaymentTransaction.status = SUCCESS` + `paidAt` มีค่า และ `AlertQueue` 1 แถว

> ℹ️ `stripe trigger checkout.session.completed` สร้าง session **ใหม่ของ Stripe** ที่ไม่มี `PaymentTransaction` ใน DB ของเรา
> ระบบจะตอบ `200 {"received":true}` แล้ว **ไม่สร้าง Alert** (ดีไซน์เดิม: map ด้วย `providerTxId = session.id`)
> → ถ้าต้องการทดสอบว่า Alert เกิดจาก webhook ให้ใช้ **ทาง B** หรือชำระเงินจริงผ่านหน้าเว็บ (ทาง A)

### ทาง A2 — PromptPay (สแกน QR ในโหมด Test)

PromptPay เป็นวิธีจ่ายแบบ **delayed notification** จึงมี 2 จังหวะ:

1. ผู้ชมสแกน QR และกดยืนยัน → Stripe ส่ง `checkout.session.completed` โดย `payment_status = unpaid`
   → ระบบบันทึก `WebhookEventLog` แต่ **ยังไม่สร้าง Alert** (ยังไม่ยืนยันการจ่าย)
2. เมื่อเงินถูกยืนยันจริง → Stripe ส่ง `checkout.session.async_payment_succeeded`
   → `PaymentTransaction = SUCCESS` + สร้าง `AlertQueue` 1 แถว + broadcast ไป OBS ทันที
3. ถ้าจ่ายไม่สำเร็จ → `checkout.session.async_payment_failed` → `PaymentTransaction = FAILED` (ไม่มี Alert)

**Expected**: หน้า `/success` อาจแสดงก่อนที่ Alert จะขึ้น (ต่างจาก card ที่เร็วมาก) — เป็นเรื่องปกติของ async payment

### ทาง B — offline self-signed (ทดสอบ idempotency/queue/SSE ได้ครบ โดยไม่ต้องมีบัญชี Stripe)

```powershell
npx tsx scripts/e2e/03-prepare-payment.ts --amount 100
npx tsx scripts/e2e/04-send-webhook.ts
```

**Expected**
- `HTTP 200 → {"received":true}`
- `[PASS] ครั้งที่ 1: ประมวลผล event ใหม่สำเร็จ`

---

## ขั้นตอนที่ 10 — ทดสอบ Webhook ซ้ำ (idempotency)

```powershell
npx tsx scripts/e2e/04-send-webhook.ts --times 2
```

(หรือ Stripe Dashboard → Developers → Events → เลือก event → **Resend**)

**Expected**
- ครั้งที่ 1 → `HTTP 200 {"received":true}`
- ครั้งที่ 2 → `HTTP 200 {"received":true,"duplicate":true}`
- `[PASS] ครั้งที่ 2: ตรวจพบ webhook ซ้ำ และข้ามอย่างปลอดภัย (duplicate)`
- **ไม่มี Alert เพิ่ม** — ยืนยันด้วยขั้นที่ 11 (`AlertQueue` ต้องมี 1 แถวเท่านั้น)

ทดสอบเพิ่มเติม (optional)

```powershell
npx tsx scripts/e2e/04-send-webhook.ts --mode unsigned      # Expected: 400
npx tsx scripts/e2e/04-send-webhook.ts --mode tampered      # Expected: 400 (พิสูจน์ว่าใช้ raw body ตรวจลายเซ็น)
npx tsx scripts/e2e/04-send-webhook.ts --mode expired       # Expected: 200 received และไม่สร้าง Alert
npx tsx scripts/e2e/04-send-webhook.ts --mode async_paid    # PromptPay จ่ายสำเร็จ → 200 + สร้าง Alert
npx tsx scripts/e2e/04-send-webhook.ts --mode async_failed  # PromptPay จ่ายไม่สำเร็จ → 200 + PaymentTransaction = FAILED (ไม่มี Alert)
```

---

## ขั้นตอนที่ 11 — ตรวจ DB: PaymentTransaction / WebhookEventLog / AlertQueue

```powershell
npx tsx scripts/e2e/05-verify-db.ts
```

**Expected (ต้อง PASS ทุกบรรทัด)**

| ตรวจ | ค่าที่คาดหวัง |
|---|---|
| PaymentTransaction.status | `SUCCESS` |
| PaymentTransaction.paidAt | มีค่า (ไม่ว่าง) |
| PaymentTransaction.providerTxId | ตรงกับ session ที่ทดสอบ |
| WebhookEventLog (ตาม eventId) | **1 แถว**, `processed = true`, `payloadJson` มีข้อมูล |
| AlertQueue (ตาม tipId) | **1 แถวเท่านั้น** (พิสูจน์ว่า duplicate ไม่สร้างซ้ำ) |
| AlertQueue.status | `PENDING` หรือ `PLAYING` (ก่อน ACK) |
| soundUrl / durationSeconds / ttsEnabled | `/alerts/alert.mp3` / `8` / `true` (ยอด ≥ 20) |
| AlertQueue.priority | ยอด 100 → `5` · ยอด ≥ 500 → `10` · ต่ำกว่า 100 → `0` |
| PaymentTransaction (PromptPay: ได้ `checkout.session.completed` ที่ยัง `unpaid`) | ยังเป็น `PENDING` — **ยังไม่สร้าง Alert** (ถูกต้อง เพราะยังไม่จ่ายจริง) |
| PaymentTransaction (PromptPay: ได้ `checkout.session.async_payment_succeeded`) | `SUCCESS` + สร้าง Alert 1 แถว |
| PaymentTransaction (PromptPay: ได้ `checkout.session.async_payment_failed`) | `FAILED` และไม่มี Alert |

---

## ขั้นตอนที่ 12 — ทดสอบ SSE → OBS Overlay

### 12.1 จำลองด้วยสคริปต์ (รันคู่กับขั้นที่ 15)

```powershell
# หน้าต่างที่ 1 — ฟัง stream 60 วินาที
npx tsx scripts/e2e/06-sse-client.ts --seconds 60

# หน้าต่างที่ 2 — ยิง Test Alert จาก Admin API
npx tsx scripts/e2e/07-admin-api.ts
```

**Expected (หน้าต่างที่ 1)**
- `[PASS] เชื่อมต่อ SSE สำเร็จ (HTTP 200)` และ `content-type = text/event-stream`
- ได้ `event: alert` พร้อมข้อมูล `alertId / tipId / donorName / amount / message / soundUrl / durationSeconds / ttsEnabled`
- ได้ `[keep-alive] : heartbeat` ทุก ~15 วินาที (connection ไม่หลุด)

**Negative test**

```powershell
npx tsx scripts/e2e/06-sse-client.ts --no-token
```

**Expected**: `[PASS] ไม่มี token → 401 Unauthorized`

### 12.2 ทดสอบใน OBS จริง

1. OBS → **Sources → + → Browser**
2. **URL**: `http://localhost:3300/overlay?token=<OVERLAY_TOKEN ใน .env>`
3. **Width** `1920` · **Height** `1080` · ✅ `Shutdown source when not visible` · ✅ `Refresh browser when scene becomes active`
4. **Custom CSS**: `body { background-color: rgba(0,0,0,0); margin: 0; }`

**Expected**
- Overlay เชื่อมต่อได้ทันที ไม่มีหน้า error และพื้นหลังโปร่งใส ไม่มี scrollbar
- เมื่อมี Alert: การ์ดสีม่วงเลื่อนขึ้นจากด้านล่าง แสดงชื่อผู้บริจาค + ยอด + ข้อความ + progress bar
- รีเฟรช OBS: ถ้ามี Alert ค้าง `PENDING` จะถูกส่งมาแสดงทันที (reconnect-safe)

---

## ขั้นตอนที่ 13 — ทดสอบ TTS และเสียง Alert

**สิ่งที่ต้องมีก่อน**

```powershell
# ยังไม่มีไฟล์นี้ในโปรเจกต์ (มีแค่ README.txt) → ต้องวางไฟล์เองก่อนทดสอบ
# public/alerts/alert.mp3
```

**วิธีตรวจ**

| ส่วน | ตรวจอย่างไร | Expected |
|---|---|---|
| เสียง Alert | ฟังจาก OBS Browser Source (หรือ browser เปิด `/overlay?token=...`) | ได้ยินเสียง alert ดังเมื่อการ์ดโผล่ |
| TTS | ฟังเสียงอ่านชื่อ + ยอด + ข้อความ (Web Speech API, `lang=th-TH`) | อ่านข้อความถูกต้องเมื่อ `ttsEnabled = true` |
| เงื่อนไข TTS | `amount >= minAmountForTTS` (seed = 20) | ยอด 100 → `ttsEnabled = true` / ยอด 10 → `false` |
| ปุ่มปิด TTS | กด Emergency TTS mute ใน Dashboard | TTS หยุดทันที (ทั้งที่กำลังเล่นและ alert ถัดไป) |

**หมายเหตุ**: สคริปต์ CLI ตรวจได้แค่ payload (`soundUrl`, `ttsEnabled`) และการมีอยู่ของ `public/alerts/alert.mp3`
ส่วนการได้ยินเสียงจริงต้องยืนยันใน OBS/browser (ข้อจำกัดของ Web Speech API + autoplay policy)

**ทดสอบยอดต่ำกว่าเกณฑ์ TTS (optional)**

```powershell
npx tsx scripts/e2e/99-cleanup.ts
npx tsx scripts/e2e/03-prepare-payment.ts --amount 15
npx tsx scripts/e2e/04-send-webhook.ts
npx tsx scripts/e2e/05-verify-db.ts        # ttsEnabled ต้องเป็น false
```

---

## ขั้นตอนที่ 14 — ทดสอบ ACK และสถานะ COMPLETED

```powershell
# ฟัง + ส่ง ACK อัตโนมัติเมื่อได้รับ alert (ทดสอบทั้งกรณีมี/ไม่มี token)
npx tsx scripts/e2e/06-sse-client.ts --ack --expect 1

# ตรวจว่าสถานะเปลี่ยนเป็น COMPLETED จริง
npx tsx scripts/e2e/05-verify-db.ts --expect-ack
```

**Expected**
- `[PASS] ACK พร้อม token สำเร็จ (HTTP 200)`
- `[PASS] ACK โดยไม่มี token → 401 (ถูกปฏิเสธตามที่ออกแบบ)`
- AlertQueue: `status = COMPLETED` และ `completedAt` มีค่า
- Alert ถัดไป (ถ้ามี) ถูกส่งต่อผ่าน SSE ทันที (`status = PLAYING`)

---

## ขั้นตอนที่ 15 — ทดสอบ Admin Dashboard

### 15.1 ผ่าน API

```powershell
npx tsx scripts/e2e/07-admin-api.ts
```

**Expected**
- `GET /api/admin/tips` ไม่มี token → **401**
- `GET /api/admin/tips` มี token → **200** พร้อม `tips[]` + `pagination`
- `POST /api/alerts/test` → **200** + `alertId` (และ overlay ต้องแสดง Alert นี้)
- `GET /api/admin/settings` → **200**

### 15.2 ผ่าน UI

1. เปิด `http://localhost:3300/admin/login` → ใส่ค่า `ADMIN_TOKEN` จาก `.env`
2. ไปที่ `http://localhost:3300/admin`

**Expected**
- เห็นตารางรายการทิป (รีเฟรชทุก 10 วินาที) พร้อมสถานะการจ่ายเงิน/alert
- ฟอร์ม "ทดสอบ Alert" ส่งได้ และ overlay แสดงผล
- ปุ่ม "ข้าม Alert ปัจจุบัน" / "ล้างคิวทั้งหมด" ทำงาน (ตรวจ DB ว่า `status` เปลี่ยนเป็น `SKIPPED`)
- ส่วนตั้งค่า (ยอดขั้นต่ำ / ความยาวข้อความ / เกณฑ์ TTS / ระยะเวลา Alert / blocklist) บันทึกได้

---

## ขั้นตอนที่ 16 — ทดสอบ Emergency Kill Switch

```powershell
# แนะนำ: เปิด 06-sse-client.ts ไว้ก่อน เพื่อดู event "emergency" ที่ส่งไป overlay
npx tsx scripts/e2e/06-sse-client.ts --seconds 60
npx tsx scripts/e2e/07-admin-api.ts
```

**Expected**
- `POST /api/admin/emergency {alertMuted:true, ttsMuted:true}` → `200`
- overlay ได้รับ `event: emergency` → Alert ที่กำลังเล่นถูกซ่อนทันที + TTS ถูก `cancel()`
- Alert ใหม่ที่เข้ามาหลังปิด → **ไม่แสดง** และไม่เล่น TTS
- สคริปต์จะ **เปิดคืน** สถานะเดิมให้อัตโนมัติ และยืนยันด้วย `[PASS] คืนค่า Emergency กลับเป็นสถานะเดิมเรียบร้อย`
- ตรวจใน UI: ปุ่มใน `/admin` เปลี่ยนเป็น 🔴/🟢 ตามสถานะจริง

---

## ขั้นตอนที่ 17 — สรุป Expected Result ของทุกขั้น

| ขั้น | สิ่งที่ทดสอบ | เกณฑ์ผ่าน |
|---|---|---|
| 1 | Docker Desktop / Engine | `docker info` คืนค่า version, สคริปต์ `01` → `[PASS] Docker Engine ทำงาน` |
| 2 | PostgreSQL container | `stream_tip_postgres` = `Up (healthy)` + พอร์ต 5432 เปิด |
| 3 | `DATABASE_URL` | `01` → `[PASS] เชื่อมต่อ PostgreSQL สำเร็จ (SELECT 1)` |
| 4 | `prisma db push` | `Your database is now in sync with your Prisma schema.` |
| 5 | `npm run db:seed` | `Default SystemSetting created.` + `02` → Emergency = false |
| 6 | Stripe Test env | `sk_test_` ถูกต้อง (ไม่มี warning placeholder) |
| 7 | `STRIPE_WEBHOOK_SECRET` | รูปแบบ `whsec_` ถูกต้อง |
| 8 | Stripe CLI forward | `Ready! ...` + log `[200] POST /api/webhooks/payment` |
| 9 | Payment + Webhook | `200 {"received":true}` และ `PaymentTransaction = SUCCESS` + `paidAt` |
| 10 | Duplicate webhook | ครั้งที่ 2 → `200 {"received":true,"duplicate":true}` |
| 11 | DB หลัง webhook | log = 1 แถว (`processed=true`), **AlertQueue = 1 แถว** |
| 12 | SSE → OBS | HTTP 200 `text/event-stream`, ได้ `event: alert`, heartbeat ทุก 15s, ไม่มี token = 401 |
| 13 | TTS / เสียง | ได้ยินเสียง alert (`alert.mp3`) + TTS อ่านข้อความเมื่อ `ttsEnabled=true` |
| 14 | ACK | ACK มี token = 200, ไม่มี token = 401, alert → `COMPLETED` + `completedAt` |
| 15 | Admin Dashboard | ไม่มี token = 401, มี token = 200 (tips/settings/test alert ใช้งานได้) |
| 16 | Emergency Kill Switch | ได้ `event: emergency`, Alert/TTS หยุดทันที, สถานะถูกคืนกลับหลังทดสอบ |

---

## ขั้นตอนที่ 18 — Rollback / Cleanup หลังทดสอบ

```powershell
# 1) ลบข้อมูลทดสอบทั้งหมดที่สคริปต์สร้าง (+ เปิด Emergency คืน ถ้าจำเป็น)
npx tsx scripts/e2e/99-cleanup.ts
npx tsx scripts/e2e/99-cleanup.ts --force-unmute      # ถ้าเคยปิด Emergency ค้างไว้

# 2) ตรวจว่าไม่มีข้อมูลทดสอบค้าง (ดู baseline + จำนวนแถว)
npx tsx scripts/e2e/02-verify-schema-seed.ts

# 3) หยุด process ที่เปิดไว้
#    - npm run dev        → Ctrl+C
#    - stripe listen ...  → Ctrl+C
#    - OBS Browser Source → ปิด source หรือปิด OBS

# 4) หยุด/ลบ PostgreSQL container (เลือกตามต้องการ)
docker compose stop db        # ✅ หยุดชั่วคราว — ข้อมูลยังอยู่ (แนะนำ)
docker compose down           # ลบ container — volume ยังอยู่ (ข้อมูลยังอยู่)
docker compose down -v        # ⚠️ ลบ volume = ลบข้อมูลทั้งหมด (ใช้เมื่ออยากเริ่มใหม่จริง ๆ)
```

**คืนค่าไฟล์ config ที่อาจแก้ระหว่างทดสอบ**

| ไฟล์/ค่า | ค่าเดิม (ก่อนทดสอบ) | หมายเหตุ |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | `whsec_placeholder_for_local_dev` | คืนค่าเดิม หรือใช้ค่าจริงจาก Stripe ของคุณ |
| `STRIPE_SECRET_KEY` | `sk_test_placeholder_for_local_dev` | คืนค่าเดิม หรือใช้ key จริงของคุณ |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_placeholder_for_local_dev` | เช่นเดียวกัน |
| `DATABASE_URL` | `postgresql://postgres:<DB_PASSWORD>@localhost:5432/stream_tip_db?schema=public` | ไม่ต้องแก้ถ้าทดสอบบนเครื่อง |
| ไฟล์ state | `%TEMP%\stream-tip-e2e-state.json` | ถูกลบโดย `99-cleanup.ts` แล้ว |

**ถ้าอยากเริ่มใหม่ทั้งหมด (ข้อมูลว่าง)**

```powershell
docker compose down -v        # ⚠️ ลบข้อมูลทิปจริงทั้งหมดด้วย — ยืนยันก่อนรัน
docker compose up -d db
npx prisma db push
npm run db:seed
npx tsx scripts/e2e/01-check-readiness.ts
```

**ตัวช่วยดูข้อมูล**: `npm run db:studio` (Prisma Studio)

---

## ภาคผนวก A — ตรวจแบบ manual ด้วย curl.exe (ไม่ต้องใช้สคริปต์)

```powershell
$base = "http://localhost:3300"
$overlay = "<OVERLAY_TOKEN จาก .env>"
$admin   = "<ADMIN_TOKEN จาก .env>"

# 1) SSE ไม่มี token → 401
curl.exe -i "$base/api/alerts/stream"

# 2) ACK ไม่มี token → 401
curl.exe -i -X POST "$base/api/alerts/ack" -H "Content-Type: application/json" -d "{\"alertId\":\"00000000-0000-0000-0000-000000000000\"}"

# 3) ACK มี token → 200 (เมื่อ alertId มีจริงในคิว)
curl.exe -i -X POST "$base/api/alerts/ack?token=$overlay" -H "Content-Type: application/json" -d "{\"alertId\":\"<ALERT_ID>\"}"

# 4) Admin tips (ไม่มี token → 401 / มี token → 200)
curl.exe -i "$base/api/admin/tips"
curl.exe -i "$base/api/admin/tips" -H "Authorization: Bearer $admin"

# 5) ยิง Test Alert จาก Dashboard
curl.exe -i -X POST "$base/api/alerts/test" -H "Authorization: Bearer $admin" -H "Content-Type: application/json" -d "{\"donorName\":\"Manual Test\",\"amount\":100,\"message\":\"hello\"}"
```

---

## ภาคผนวก B — ค่าอ้างอิงสำคัญ

| รายการ | ค่า |
|---|---|
| App URL | `http://localhost:3300` (`.env` → `NEXT_PUBLIC_APP_URL`) |
| Overlay | `http://localhost:3300/overlay?token=<OVERLAY_TOKEN>` |
| Admin | `http://localhost:3300/admin/login` |
| Webhook endpoint | `POST http://localhost:3300/api/webhooks/payment` |
| SSE endpoint | `GET http://localhost:3300/api/alerts/stream?token=<OVERLAY_TOKEN>` |
| ACK endpoint | `POST http://localhost:3300/api/alerts/ack?token=<OVERLAY_TOKEN>` |
| PostgreSQL (Docker) | container `stream_tip_postgres` · port `5432` · db `stream_tip_db` · user/pass `postgres` / `<DB_PASSWORD>` |
| Seed defaults | `minTipAmount=10` · `minAmountForTTS=20` · `alertDurationSec=8` · priority `<100→0`, `100–499→5`, `≥500→10` |
| สคริปต์ | `npx tsx scripts/e2e/<file>.ts` (tsx มีอยู่ใน devDependencies แล้ว) |
| State file | `%TEMP%\stream-tip-e2e-state.json` |

---

## ภาคผนวก C — แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
|---|---|---|
| `docker: failed to connect to the docker API ... pipe/dockerDesktopLinuxEngine` | Docker Desktop ปิด หรือ WSL2 ยังไม่พร้อม | เปิด Docker Desktop / ทำข้อ 0 (Virtual Machine Platform + reboot) |
| `WSL2 is not supported with your current machine configuration` | ยังไม่เปิดฟีเจอร์ Virtual Machine Platform | ข้อ 0 |
| `Prisma P1001: Can't reach database server at localhost:5432` | container ยังไม่ healthy หรือพอร์ตชน | `docker compose ps` / `docker compose logs db` |
| `prisma db push` ค้างถามเรื่อง data loss | schema เปลี่ยนแบบทำให้ข้อมูลหาย | หยุด แล้ว backup/dump ก่อน — ห้ามกดยืนยันมั่ว |
| Webhook ตอบ `400 Invalid webhook signature` | secret ใน `.env` ไม่ตรงกับที่ใช้เซ็น (เช่น ใช้ `whsec_` ของ `stripe listen` session เก่า) | ใช้ค่าล่าสุดจาก `stripe listen` หรือใช้สคริปต์ `04` (เซ็นด้วยค่าใน `.env`) |
| Webhook ตอบ `200 received:true` แต่ไม่มี Alert | ไม่พบ `PaymentTransaction` ที่ `providerTxId` ตรง (เช่น `stripe trigger` สร้าง session ใหม่) | ใช้ทาง B (`03`+`04`) หรือจ่ายจริงผ่านหน้าเว็บ |
| Overlay ไม่แสดง Alert | token ผิด / Emergency ปิดอยู่ / alert ไม่ได้เป็น `PENDING` | `06-sse-client.ts --no-token` (ต้อง 401) → ตรวจ `/admin` Emergency → `05-verify-db.ts` |
| ไม่มีเสียง Alert | ยังไม่มี `public/alerts/alert.mp3` | วางไฟล์ mp3 (ดู `public/alerts/README.txt`) |
| TTS ไม่ดัง | autoplay policy ของ browser | คลิก/interact ในหน้า overlay 1 ครั้ง + ตรวจ mixer ของ OBS |
| `warn The configuration property package.json#prisma is deprecated` | warning ของ Prisma 6 | ไม่กระทบการทดสอบ |

---

## ขั้นตอนแรกที่ควรรัน "หลัง PostgreSQL พร้อมแล้ว"

```powershell
cd C:\Users\Acer\Desktop\Twitch\stream-tip-system

# 1) เปิด DB แล้วตรวจความพร้อมทั้งชุด (engine, container, port, DATABASE_URL, Stripe env)
docker compose up -d db
npx tsx scripts/e2e/01-check-readiness.ts

# 2) เตรียม schema + seed แล้วตรวจ
npx prisma db push
npm run db:seed
npx tsx scripts/e2e/02-verify-schema-seed.ts

# 3) เปิดแอป (หน้าต่างที่ 1) แล้วทำขั้นที่ 9 เป็นต้นไปตาม runbook นี้
npm run dev
```
