import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // เอนจินควันที่ generate มาจากระบบเก่า (ดู scripts/extract-smoke-engine.mjs) — ไม่ใช่โค้ดที่เราแก้เอง
    "public/smoke/smoke-engine.js",
  ]),
]);

export default eslintConfig;
