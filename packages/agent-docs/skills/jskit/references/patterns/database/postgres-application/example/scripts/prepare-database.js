import { prepareDatabaseFromApp } from "@jskit-ai/database-runtime/server/databaseSetup";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

await prepareDatabaseFromApp({ client: "pg", environment: process.env });
