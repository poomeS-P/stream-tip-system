#!/bin/sh
# ============================================================
# docker-entrypoint.sh — เตรียมฐานข้อมูลก่อนเริ่มแอป (production)
#
# เหตุผลที่ต้องมี: production เคยเจอ Prisma P2021
#   ("The table public.SystemSetting does not exist") เพราะ `prisma migrate deploy`
#   ยังไม่ถูกเรียกกับ DATABASE_URL ของ production จริง
#   (railway.json มี preDeployCommand ไว้แล้ว แต่ต้องไม่พึ่งการตั้งค่าใน Dashboard
#    เพราะ Service settings บางกรณีทับค่าจาก config-as-code ได้)
#
# หลักการ:
#   - ใช้ `prisma migrate deploy` เท่านั้น  ❌ ห้ามใช้ `prisma db push` กับ production
#   - idempotent: ถ้าไม่มี migration ค้าง จะเป็น no-op (เร็ว)
#   - ถ้า migrate ล้มเหลว → ออกทันที (container ไม่ขึ้น + deployment fail ชัดเจน)
#   - seed เป็น idempotent (สร้าง SystemSetting เฉพาะเมื่อยังไม่มี) และ "ไม่ fatal"
#     ปิดได้ด้วย RUN_DB_SEED=0
#   - ไม่พิมพ์ค่า secret ใด ๆ ออก log
# ============================================================
set -e

# ให้ prisma/tsx หาเจอจาก local node_modules + มีที่เขียน cache ได้โดยไม่ต้องพึ่ง HOME ของผู้ใช้
export PATH="/app/node_modules/.bin:$PATH"
export HOME="${HOME:-/tmp}"
export npm_config_cache="${npm_config_cache:-/tmp/.npm}"
export NPM_CONFIG_UPDATE_NOTIFIER=false

echo "[entrypoint] prisma migrate deploy (production DATABASE_URL)"
npx prisma migrate deploy

if [ "${RUN_DB_SEED:-1}" = "1" ]; then
    echo "[entrypoint] prisma db seed (idempotent; set RUN_DB_SEED=0 to skip)"
    if ! npm run db:seed; then
        echo "[entrypoint] WARNING: seed failed (non-fatal) — app will use built-in defaults"
    fi
else
    echo "[entrypoint] seed skipped (RUN_DB_SEED=0)"
fi

echo "[entrypoint] starting app: $*"
exec "$@"
