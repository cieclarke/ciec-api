const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
try {
  const adapter = new PrismaMariaDb({
    host: "localhost",
    port: 3306,
    connectionLimit: 5,
  });
  const prisma = new PrismaClient({ adapter });
  console.log("Success with datasourceUrl");
} catch (e) {
  console.log("Error:", e.message);
}
