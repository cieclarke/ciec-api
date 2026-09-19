import { defineConfig } from "@prisma/config";
import process from "node:process";

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
