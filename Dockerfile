# ============================================================
# stream-tip-system — production image
#
# ทำไมใช้ Dockerfile (แทน Nixpacks):
#   - ตรึง Node/npm ให้ reproducible:  node:24-slim → Node 24 + npm 11.x
#     (Nixpacks ยังใช้ npm 10 ซึ่งปฏิเสธ package-lock.json นี้ด้วยบั๊ก
#      "Missing: @emnapi/* from lock file" ของ optional dependency)
#   - ใช้ npm ci จาก lock เท่านั้น → ห้ามใช้ npm install ในทุกขั้นตอนของ build
#   - ใช้ Debian (glibc) ให้ตรงกับ binary ที่ lock เลือกไว้:
#     @next/swc-linux-x64-gnu, @tailwindcss/oxide-linux-x64-gnu,
#     lightningcss-linux-x64-gnu, @img/sharp-linux-x64, esbuild
#
# Railway ใช้ไฟล์นี้เมื่อ railway.json ตั้ง `"builder": "DOCKERFILE"`
#   - runtime env: Railway ฉีด PORT ให้เอง (ไม่ hard-code) → `next start` อ่านค่านั้น
#   - pre-deploy: `npx prisma migrate deploy` (Prisma CLI อยู่ใน image นี้แล้ว)
#   - healthcheck: GET /api/health
# ============================================================

FROM node:24-slim AS base
WORKDIR /app

# openssl = สิ่งที่ Prisma engine ต้องใช้บน Debian slim
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ยืนยันเวอร์ชันจริงใน image — ถ้าไม่ใช่ Node 24 / npm 11 ให้ build ล้มทันที
# (กัน regression เช่น image tag เปลี่ยนหรือถูกลดเวอร์ชันโดยไม่ตั้งใจ)
RUN node --version && npm --version \
    && node -e "const v=process.versions.node; if(v.split('.')[0]!=='24'){console.error('FAIL: Node 24 required, got '+v);process.exit(1)}; console.log('OK: Node '+v)" \
    && node -e "const {execSync}=require('child_process'); const m=execSync('npm --version').toString().trim(); if(!m.startsWith('11.')){console.error('FAIL: npm 11.x required, got '+m);process.exit(1)}; console.log('OK: npm '+m)"

# ---------- 1) dependencies (ติดตั้งจาก lock เท่านั้น) ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma/
# postinstall ของโปรเจกต์ = `prisma generate` (สร้าง client ให้ตรง schema)
RUN npm ci --no-audit --no-fund

# ---------- 2) build (Next.js production) ----------
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# Railway ส่ง service variables ให้ตอน build ได้ แต่ต้องประกาศเป็น ARG
# (เอกสาร Railway: "Using variables at build time")
# NEXT_PUBLIC_* ถูก inline ลง bundle ตอน build → ต้องส่งค่าจริงมาจาก Railway
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-pk_test_build_placeholder}

# ตัวแปรที่ไม่ใช่ NEXT_PUBLIC_ จะถูกอ่านจาก runtime เสมอ (ไม่ inline)
# → ใช้ placeholder เฉพาะใน RUN นี้ เพื่อให้ผ่าน validation (zod) ตอน build
#   ไม่ตั้งเป็น ENV ของ image (ไม่ติด metadata + ไม่ขึ้น warning SecretsUsedInArgOrEnv)
RUN export DATABASE_URL="postgresql://build_placeholder:build_placeholder@127.0.0.1:5432/build_placeholder?schema=public" \
    && export ADMIN_TOKEN="build_time_placeholder_admin_token_0001" \
    && export OVERLAY_TOKEN="build_time_placeholder_overlay_token_0001" \
    && export STRIPE_SECRET_KEY="sk_test_build_time_placeholder" \
    && export STRIPE_WEBHOOK_SECRET="whsec_build_time_placeholder" \
    && npx prisma generate \
    && npm run build

# ---------- 3) runtime ----------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# หมายเหตุ: ไม่ตั้ง PORT ที่นี่ — Railway ฉีดให้ตอน runtime และ `next start` อ่านค่านั้น
#           (ถ้าไม่มี PORT เลย Next จะ fallback เป็น 3000 ตาม EXPOSE ด้านล่าง)

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# node_modules แบบเต็ม (prod + dev) เพื่อให้ npx prisma / npm run db:seed ใช้ใน container ได้
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/next-env.d.ts ./next-env.d.ts
# entrypoint: รัน `prisma migrate deploy` (+ seed ครั้งแรก) ก่อนเริ่มเซิร์ฟเวอร์
# ทำให้การสร้าง schema ของ production ไม่ขึ้นกับ setting ใน Dashboard อีก
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
# script ช่วยตรวจสอบ (เช่น scripts/verify-db-tables.mjs) ให้ใช้ใน Railway Shell ได้
COPY --chown=nextjs:nodejs scripts ./scripts

USER nextjs
EXPOSE 3000

# entrypoint จะรัน migrate/seed แล้ว exec ต่อเป็นเซิร์ฟเวอร์ (PID 1 = node)
ENTRYPOINT ["./docker-entrypoint.sh"]

# รัน node ตรง ๆ (ไม่ผ่าน npm) เพื่อให้ PID 1 รับ SIGTERM เองตามที่ Railway แนะนำ
CMD ["node", "node_modules/next/dist/bin/next", "start"]

