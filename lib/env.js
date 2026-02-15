import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { cleanEnv, num, port, str } from "envalid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config({
  path: path.resolve(__dirname, "..", ".env.local"),
  override: false
});

export const env = cleanEnv(
  process.env,
  {
    NODE_ENV: str({
      choices: ["development", "production", "test"],
      default: "development"
    }),
    PORT: port({ default: 3000 }),
    DB_HOST: str({ default: "127.0.0.1" }),
    DB_PORT: port({ default: 3306 }),
    DB_USER: str({ default: "annuity_app" }),
    DB_PASSWORD: str({ default: "" }),
    DB_NAME: str({ default: "material-app" }),
    DB_TEST_NAME: str({ default: "" }),
    DB_POOL_MAX: num({ default: 10 }),
    SUPABASE_URL: str({ default: "" }),
    SUPABASE_PUBLISHABLE_KEY: str({ default: "" }),
    SUPABASE_JWT_AUDIENCE: str({ default: "authenticated" }),
    APP_PUBLIC_URL: str({ default: "" })
  },
  {
    strict: true
  }
);
