import { PrismaClient } from "@prisma/client";
import { DEFAULT_MIN_AMOUNT_FOR_TTS } from "../src/lib/payment/limits";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database default settings...");

  const existing = await prisma.systemSetting.findUnique({
    where: { id: "default" },
  });

  if (!existing) {
    await prisma.systemSetting.create({
      data: {
        id: "default",
        streamerName: "Streamer",
        minTipAmount: 1.0,
        maxMessageLength: 150,
        // เกณฑ์อ่านเสียง = ยอดขั้นต่ำที่ Stripe ยอมรับ (THB = 10) → โดเนทที่จ่ายได้จริงมีเสียงอ่านเสมอ
        minAmountForTTS: DEFAULT_MIN_AMOUNT_FOR_TTS,
        alertDurationSec: 8,
        emergencyAlertMuted: false,
        emergencyTTSMuted: false,
        bannedWords: [
          "spam",
          "scam",
          "hack",
          "free robux",
          "discord.gg",
          "ควย",
          "เย็ด",
          "สัส",
          "เหี้ย",
          "มึง",
          "กู",
        ],
        blockEntireMessage: false,
      },
    });
    console.log("Default SystemSetting created.");
  } else {
    console.log("SystemSetting already exists, skipping seed.");
  }
}

main()
  .catch((e) => {
    console.error("Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
