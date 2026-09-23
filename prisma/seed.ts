import { PrismaClient } from "@prisma/client";

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
        minAmountForTTS: 20.0,
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
