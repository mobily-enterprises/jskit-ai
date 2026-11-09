// readable-check: allow no-direct-knex - infrastructure: an operator's one-off import of accounts into the hub's own account table
import { createAccountStore, isEmail, normalizeEmail } from "./accounts.js";
import { systemClock } from "./clock.js";

const PASSWORD_FIELDS = ["password_algorithm", "password_version", "password_salt", "password_hash"];
// Rows looked up and inserted per statement.
const ROWS_PER_STATEMENT = 500;

function parseLine(line) {
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
  const nested = value.password && typeof value.password === "object" ? value.password : null;
  const row = {
    id: String(value.id ?? "").trim(),
    email: normalizeEmail(value.email),
    display_name: String(value.display_name ?? value.displayName ?? "").trim(),
    password_algorithm: String(value.password_algorithm ?? nested?.algorithm ?? ""),
    password_version: String(value.password_version ?? nested?.version ?? ""),
    password_salt: String(value.password_salt ?? nested?.salt ?? ""),
    password_hash: String(value.password_hash ?? nested?.hash ?? ""),
    disabled: Boolean(value.disabled)
  };
  if (!row.id || !isEmail(row.email) || PASSWORD_FIELDS.some((field) => !row[field])) {
    throw new Error("missing id, email or password fields");
  }
  return row;
}

function samePassword(existing, row) {
  return PASSWORD_FIELDS.every((field) => existing[field] === row[field]);
}

/**
 * Imports JSKIT local accounts exported as JSON Lines. Ids become the hub's
 * `sub`, scrypt fields are kept byte for byte, and email starts unverified.
 * Dry-run unless `apply` is true. Rows that clash with a different existing
 * account are refused and reported, never merged.
 * @param {object} input
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} input.knex
 * @param {string} input.text The exported accounts, one JSON object per line.
 * @param {boolean} [input.apply] True to write the accounts; otherwise only counts them.
 * @param {import("./types.js").HubClock} [input.now]
 */
async function importAccounts({ knex, text, apply = false, now = systemClock }) {
  const accounts = createAccountStore({ knex, now });
  const result = { imported: 0, skipped: 0, conflicts: [] };
  const seen = new Set();
  const candidates = [];
  const lines = String(text).split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const lineNumber = index + 1;
    let row;
    try {
      row = parseLine(line);
    } catch (error) {
      result.conflicts.push({ line: lineNumber, reason: `unreadable row (${error.message})` });
      continue;
    }
    if (seen.has(row.id) || seen.has(row.email)) {
      result.conflicts.push({ line: lineNumber, id: row.id, reason: "repeats an earlier row" });
      continue;
    }
    seen.add(row.id).add(row.email);
    candidates.push({ lineNumber, row });
  }

  for (let start = 0; start < candidates.length; start += ROWS_PER_STATEMENT) {
    const chunk = candidates.slice(start, start + ROWS_PER_STATEMENT);
    const existing = await accounts.rawByIdsOrEmails(chunk.map(({ row }) => row.id), chunk.map(({ row }) => row.email));
    const existingById = new Map(existing.map((account) => [account.id, account]));
    const existingByEmail = new Map(existing.map((account) => [normalizeEmail(account.email), account]));
    const fresh = [];
    for (const { lineNumber, row } of chunk) {
      const byId = existingById.get(row.id);
      const byEmail = existingByEmail.get(row.email);
      if (byId && byEmail && byId.id === byEmail.id && samePassword(byId, row)) {
        result.skipped += 1;
        continue;
      }
      if (byId || byEmail) {
        result.conflicts.push({
          line: lineNumber,
          id: row.id,
          reason: byId ? "this id belongs to a different hub account" : "this email belongs to a different hub account"
        });
        continue;
      }
      fresh.push(row);
    }
    if (apply) await accounts.importLocal(fresh);
    result.imported += fresh.length;
  }
  result.conflicts.sort((left, right) => left.line - right.line);
  return result;
}

function describeImport(result, { apply }) {
  const counts = apply
    ? `Imported ${result.imported} accounts, skipped ${result.skipped} already present, refused ${result.conflicts.length} conflicts.`
    : `Would import ${result.imported} accounts, skip ${result.skipped} already present, refuse ${result.conflicts.length} conflicts.`;
  const details = result.conflicts.map((conflict) =>
    `  line ${conflict.line}${conflict.id ? ` (${conflict.id})` : ""}: ${conflict.reason}`);
  return [counts, ...details].join("\n");
}

export { describeImport, importAccounts };
