import { prepareDatabaseFromApp } from "@jskit-ai/database-runtime/server/databaseSetup";

await prepareDatabaseFromApp({ client: "mysql2", environment: process.env });
