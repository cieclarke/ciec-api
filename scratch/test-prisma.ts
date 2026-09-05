import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const res = await prisma.image.findMany({
    where: {
      tags: {
        array_contains: "nature"
      }
    }
  });
  console.log("Success");
}
main().catch(e => { console.error(e.message); process.exit(1); });
