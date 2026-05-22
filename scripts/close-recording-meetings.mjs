/**
 * Sluit alle vergaderingen met status "recording" af (eenmalig onderhoud).
 * Handig als een opname is vastgelopen en quick-start daardoor blokkeert.
 *
 * Run vanuit de projectmap:
 *   node --env-file=.env scripts/close-recording-meetings.mjs
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(
    "DATABASE_URL ontbreekt. Run met: node --env-file=.env scripts/close-recording-meetings.mjs",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const open = await prisma.meeting.findMany({
    where: { status: "recording" },
    select: { id: true, title: true },
  });

  if (open.length === 0) {
    console.log("Geen lopende opnames gevonden.");
  } else {
    const result = await prisma.meeting.updateMany({
      where: { status: "recording" },
      data: { status: "completed", endedAt: new Date() },
    });
    console.log(`${result.count} opname(s) afgesloten:`);
    for (const m of open) console.log(`  - ${m.title} (${m.id})`);
  }
} finally {
  await prisma.$disconnect();
  await pool.end();
}
