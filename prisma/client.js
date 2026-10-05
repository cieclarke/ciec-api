const { PrismaClient } = require("./path/to/generated/prisma");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

const adapter = new PrismaMariaDb({
  host: "localhost",
  user: "ciec",
  database: "cieclar1_api",
  password=""
});

export const prisma = new PrismaClient({ adapter });
