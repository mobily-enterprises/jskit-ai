// readable-check: allow no-direct-knex - infrastructure: the accounts hub's own sign-in accounts (oidc_issuer_accounts), the identity backend of its OpenID provider

import { readFileSync } from "node:fs";
import { createAccountId, hashPassword, verifyPassword } from "./crypto.js";
import { hubEnglish } from "./hubTexts.js";

const ACCOUNTS_TABLE = "oidc_issuer_accounts";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const LOCK_AFTER_FAILURES = 100;
const COMMON_PASSWORDS_URL = new URL("../../data/common-passwords.txt", import.meta.url);

let commonPasswords = null;

// Each refusal a person can see: its code, status and the messageCode (with
// params) its English renders from.
const ACCOUNT_ERRORS = Object.freeze({
  emailInvalid: { code: "email_invalid", status: 400, messageCode: "accounts.account.emailInvalid" },
  emailTaken: { code: "email_taken", status: 409, messageCode: "accounts.account.emailTaken" },
  displayNameRequired: { code: "display_name_required", status: 400, messageCode: "accounts.account.displayNameRequired" },
  passwordRequired: { code: "password_required", status: 400, messageCode: "accounts.google.passwordRequired" },
  passwordTooShort: {
    code: "password_too_short",
    status: 400,
    messageCode: "accounts.password.tooShort",
    params: { min: PASSWORD_MIN_LENGTH }
  },
  passwordTooLong: {
    code: "password_too_long",
    status: 400,
    messageCode: "accounts.password.tooLong",
    params: { max: PASSWORD_MAX_LENGTH }
  },
  passwordTooCommon: { code: "password_too_common", status: 400, messageCode: "accounts.password.tooCommon" }
});

/** One refusal as its code, English, messageCode and params. */
function accountText(entry) {
  const messageParams = entry.params || {};
  return { code: entry.code, message: hubEnglish(entry.messageCode, messageParams), messageCode: entry.messageCode, messageParams };
}

function isCommonPassword(password) {
  commonPasswords ??= new Set(readFileSync(COMMON_PASSWORDS_URL, "utf8").split("\n").filter(Boolean));
  return commonPasswords.has(String(password).toLowerCase());
}

function passwordProblemEntry(password) {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN_LENGTH) return ACCOUNT_ERRORS.passwordTooShort;
  if (value.length > PASSWORD_MAX_LENGTH) return ACCOUNT_ERRORS.passwordTooLong;
  if (isCommonPassword(value)) return ACCOUNT_ERRORS.passwordTooCommon;
  return null;
}

/**
 * Why a password is refused, as its own code, English, messageCode and params,
 * or null when it is acceptable.
 * @param {unknown} password
 * @returns {{ code: string, message: string, messageCode: string, messageParams: Record<string, unknown> } | null}
 */
function passwordProblem(password) {
  const entry = passwordProblemEntry(password);
  return entry ? accountText(entry) : null;
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320;
}

function displayNameFor(value, email) {
  const name = String(value ?? "").trim().slice(0, 160);
  return name || email.split("@")[0] || "Account";
}

function passwordRecord(row) {
  return {
    algorithm: row.password_algorithm,
    version: row.password_version,
    salt: row.password_salt,
    hash: row.password_hash
  };
}

function passwordColumns(record) {
  return {
    password_algorithm: record.algorithm,
    password_version: record.version,
    password_salt: record.salt,
    password_hash: record.hash
  };
}

function toAccount(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    displayName: row.display_name,
    // A listed row says only whether these are set (has_password, google_linked), never what they hold.
    hasPassword: Boolean(Object.hasOwn(row, "has_password") ? row.has_password : row.password_hash),
    googleLinked: Boolean(Object.hasOwn(row, "google_linked") ? row.google_linked : row.google_sub),
    disabled: Boolean(row.disabled),
    locked: Number(row.failed_logins) >= LOCK_AFTER_FAILURES,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

class AccountError extends Error {
  constructor(code, message, status = 400, { messageCode = "", messageParams = {} } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    if (messageCode) {
      this.messageCode = messageCode;
      this.messageParams = messageParams;
    }
  }
}

function accountError(entry) {
  const { code, message, messageCode, messageParams } = accountText(entry);
  return new AccountError(code, message, entry.status, { messageCode, messageParams });
}

/**
 * The hub's accounts: their emails, passwords, Google links and lockouts.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {import("./types.js").HubClock} dependencies.now
 */
function createAccountStore({ knex, now }) {
  const table = () => knex(ACCOUNTS_TABLE);

  async function rowByEmail(email) {
    return table().where({ email: normalizeEmail(email) }).first();
  }

  async function update(id, values) {
    await table().where({ id }).update({ ...values, updated_at: now() });
    return toAccount(await table().where({ id }).first());
  }

  async function findById(id) {
    return toAccount(await table().where({ id: String(id ?? "") }).first());
  }

  async function findByEmail(email) {
    return toAccount(await rowByEmail(email));
  }

  async function findByGoogleSub(googleSub) {
    return toAccount(await table().where({ google_sub: String(googleSub ?? "") }).first());
  }

  // Every account, newest first, reading only the columns an account's summary shows: never a password's hash or
  // salt, nor the Google subject, of which it says only whether they are set.
  async function list() {
    const rows = await table()
      .select("id", "email", "email_verified", "display_name", "disabled", "failed_logins", "created_at", "updated_at")
      .select(
        knex.raw("?? is not null as ??", ["password_hash", "has_password"]),
        knex.raw("?? is not null as ??", ["google_sub", "google_linked"])
      )
      .orderBy("created_at", "desc");
    return rows.map(toAccount);
  }

  async function create({ email, password = null, displayName = "", emailVerified = false, googleSub = null }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isEmail(normalizedEmail)) {
      throw accountError(ACCOUNT_ERRORS.emailInvalid);
    }
    if (password !== null) {
      const problem = passwordProblemEntry(password);
      if (problem) throw accountError(problem);
    }
    if (await rowByEmail(normalizedEmail)) {
      throw accountError(ACCOUNT_ERRORS.emailTaken);
    }
    const id = createAccountId();
    const timestamp = now();
    await table().insert({
      id,
      email: normalizedEmail,
      email_verified: Boolean(emailVerified),
      display_name: displayNameFor(displayName, normalizedEmail),
      ...(password === null ? {} : passwordColumns(await hashPassword(password))),
      google_sub: googleSub,
      disabled: false,
      failed_logins: 0,
      created_at: timestamp,
      updated_at: timestamp
    });
    return toAccount(await table().where({ id }).first());
  }

  /**
   * Checks an email and password. Unknown emails, wrong passwords, disabled
   * and locked accounts all fail the same way, so the caller shows one
   * generic sentence. A locked account stays locked until recovery, even
   * with the right password.
   */
  async function authenticate(email, password) {
    const row = await rowByEmail(email);
    if (!row || !row.password_hash) {
      await verifyPassword(password, { algorithm: "scrypt", version: "v1", salt: "AAAA", hash: "A".repeat(86) });
      return null;
    }
    if (Number(row.failed_logins) >= LOCK_AFTER_FAILURES || row.disabled) {
      return null;
    }
    if (!(await verifyPassword(password, passwordRecord(row)))) {
      await table().where({ id: row.id }).increment("failed_logins", 1);
      return null;
    }
    if (Number(row.failed_logins) > 0) {
      await table().where({ id: row.id }).update({ failed_logins: 0 });
    }
    return toAccount(row);
  }

  async function checkPassword(id, password) {
    const row = await table().where({ id }).first();
    return Boolean(row?.password_hash) && verifyPassword(password, passwordRecord(row));
  }

  async function setPassword(id, password) {
    const problem = passwordProblemEntry(password);
    if (problem) throw accountError(problem);
    return update(id, { ...passwordColumns(await hashPassword(password)), failed_logins: 0 });
  }

  async function clearPassword(id) {
    return update(id, {
      password_algorithm: null,
      password_version: null,
      password_salt: null,
      password_hash: null
    });
  }

  async function updateProfile(id, { displayName }) {
    const name = String(displayName ?? "").trim();
    if (!name) throw accountError(ACCOUNT_ERRORS.displayNameRequired);
    return update(id, { display_name: name.slice(0, 160) });
  }

  function markEmailVerified(id) {
    return update(id, { email_verified: true });
  }

  function linkGoogle(id, googleSub) {
    return update(id, { google_sub: String(googleSub) });
  }

  async function unlinkGoogle(id) {
    const row = await table().where({ id }).first();
    if (!row?.password_hash) {
      throw accountError(ACCOUNT_ERRORS.passwordRequired);
    }
    return update(id, { google_sub: null });
  }

  function setDisabled(id, disabled) {
    return update(id, { disabled: Boolean(disabled) });
  }

  /** Imports exported JSKIT local accounts in one statement, keeping their ids and scrypt fields byte for byte. */
  async function importLocal(rows) {
    if (rows.length === 0) return;
    const timestamp = now();
    await table().insert(rows.map((row) => ({
      id: row.id,
      email: normalizeEmail(row.email),
      email_verified: false,
      display_name: displayNameFor(row.display_name, normalizeEmail(row.email)),
      password_algorithm: row.password_algorithm,
      password_version: row.password_version,
      password_salt: row.password_salt,
      password_hash: row.password_hash,
      google_sub: null,
      disabled: Boolean(row.disabled),
      failed_logins: 0,
      created_at: timestamp,
      updated_at: timestamp
    })));
  }

  /** The stored rows whose id or email is one of these, in one read. */
  async function rawByIdsOrEmails(ids, emails) {
    return table().whereIn("id", ids).orWhereIn("email", emails.map(normalizeEmail));
  }

  return Object.freeze({
    findById,
    findByEmail,
    findByGoogleSub,
    list,
    create,
    authenticate,
    checkPassword,
    // readable-check: allow setter-seam - not a slot: setPassword changes an account's password
    setPassword,
    clearPassword,
    updateProfile,
    markEmailVerified,
    linkGoogle,
    unlinkGoogle,
    // readable-check: allow setter-seam - not a slot: setDisabled changes an account's status
    setDisabled,
    importLocal,
    rawByIdsOrEmails
  });
}

export {
  ACCOUNTS_TABLE,
  AccountError,
  LOCK_AFTER_FAILURES,
  createAccountStore,
  isEmail,
  normalizeEmail,
  passwordProblem
};
