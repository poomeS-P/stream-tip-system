/**
 * ตรวจสูตรคำนวณ "Top Donors" (ยอดสะสม) จากฐานข้อมูลจริงในเครื่อง
 * รัน: npx tsx scripts/top-donors-preview.ts [--include-test] [--limit 3]
 *
 * ทำไมต้องมี: กติกาการนับ (SUCCESS เท่านั้น · ยอดจริง live only · รวมยอดต่อคน · 匿名) สำคัญมาก
 * และต้องพิสูจน์ได้โดยไม่ต้องเปิด OBS — สคริปต์นี้ใช้ "สูตรเดียวกับ API" (src/lib/top-donors.ts)
 *
 * --include-test = นับยอดทดสอบด้วย (ใช้เฉพาะ dev/ทดสอบ UI) · ค่าเริ่มต้น = ยอดจริงเท่านั้น
 */

import { getTopDonors, ANONYMOUS_DISPLAY_NAME } from "../src/lib/top-donors";
import { fail, finish, info, loadEnvFile, pass, section } from "./e2e/_shared";

interface Options {
  includeTest: boolean;
  limit: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const index = args.indexOf("--limit");
  const limit = index >= 0 ? Number(args[index + 1]) : 3;

  return {
    includeTest: args.includes("--include-test"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 3,
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const options = parseArgs();

  section("Top Donors — สรุปยอดสะสมสูงสุด");
  const mode = options.includeTest ? "all" : "live";
  info(`   mode  = ${mode}${options.includeTest ? " (รวมยอดทดสอบ — dev เท่านั้น)" : " (ยอดจริงเท่านั้น)"}`);
  info(`   limit = ${options.limit}`);

  const result = await getTopDonors({ limit: options.limit, mode, currency: process.env.DEFAULT_CURRENCY ?? "THB" });

  info(`   currency = ${result.currency} · generatedAt = ${result.generatedAt}`);
  info("");

  if (result.donors.length === 0) {
    info("   (ยังไม่มีผู้สนับสนุนที่เข้าเงื่อนไข)");
  } else {
    info("   อันดับ | ชื่อที่แสดง        | ยอดสะสม    | จำนวนครั้ง | 匿名");
    info("   ------+-------------------+-----------+-----------+-----");
    for (const donor of result.donors) {
      const name = donor.displayName.padEnd(17, " ");
      const total = donor.total.toLocaleString("th-TH");
      info(`     ${String(donor.rank).padStart(2, "0")}  | ${name} | ${total.padStart(8, " ")} | ${String(donor.donationCount).padStart(9, " ")} | ${donor.anonymous ? "ใช่" : "ไม่"}`);
    }
  }

  info("");
  info("   ตรวจกติกา:");
  const sorted = result.donors.every((donor, index) => index === 0 || donor.total <= result.donors[index - 1].total);
  if (sorted) pass("เรียงจากยอดมาก → น้อย ถูกต้อง");
  else fail("ลำดับยอดไม่ถูกต้อง", "ต้องเรียงจากมากไปน้อย");

  const ranked = result.donors.every((donor, index) => donor.rank === index + 1);
  if (ranked) pass("rank ต่อเนื่องเริ่มจาก 1 ถูกต้อง");
  else fail("rank ไม่ต่อเนื่อง");

  const anonymousSafe = result.donors.every(
    (donor) => !donor.anonymous || donor.displayName === ANONYMOUS_DISPLAY_NAME
  );
  if (anonymousSafe) pass("ผู้บริจาคที่匿名 แสดงเป็น \"" + ANONYMOUS_DISPLAY_NAME + "\" เท่านั้น (ไม่เปิดเผยชื่อจริง)");
  else fail("พบชื่อจริงของผู้ที่เลือก匿名", "ต้องแสดงเป็น " + ANONYMOUS_DISPLAY_NAME + " เท่านั้น");

  if (result.donors.length <= options.limit) pass(`จำนวนรายการไม่เกิน limit (${options.limit})`);
  else fail(`ได้ ${result.donors.length} รายการ เกิน limit`);

  info("");
  info("   หมายเหตุ: โหมด live จะนับเฉพาะ providerTxId ขึ้นต้นด้วย cs_live_ (ยอดจริง) → ยอดทดสอบ cs_test_* ไม่ถูกรวม");

  finish();
}

void main();
