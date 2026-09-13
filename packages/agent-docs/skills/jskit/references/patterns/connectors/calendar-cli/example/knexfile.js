import { existsSync } from "node:fs";
import { createKnexMigrationConfigFromApp } from "@jskit-ai/database-runtime/server/knexMigrationConfig";

if (existsSync(".env")) process.loadEnvFile(".env");
export default await createKnexMigrationConfigFromApp({ client: "mysql2" });
