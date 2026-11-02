import { prepareDatabaseFromApp } from "@jskit-ai/database-runtime/server/databaseSetup";

await prepareDatabaseFromApp({ client: "pg", environment: process.env });
