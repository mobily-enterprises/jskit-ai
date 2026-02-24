import { randomBytes } from "node:crypto";

function buildDisabledPasswordSecret() {
  const randomSegment = randomBytes(24).toString("base64url");
  // Supabase password updates follow bcrypt's 72-byte input limit.
  return `disabled-A1!-${randomSegment}`;
}

export { buildDisabledPasswordSecret };
