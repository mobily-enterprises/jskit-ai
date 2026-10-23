import { readFileSync } from "node:fs";
import { createAccountId, hashPassword, verifyPassword } from "./crypto.js";

const ACCOUNTS_TABLE = "oidc_issuer_accounts";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const LOCK_AFTER_FAILURES = 100;
const COMMON_PASSWORDS_URL = new URL("../../data/common-passwords.txt", import.meta.url);

let commonPasswords = null;

function isCommonPassword(password) {
  commonPasswords ??= new Set(readFileSync(COMMON_PASSWORDS_URL, "utf8").split("\n").filter(Boolean));
  return commonPasswords.has(String(password).toLowerCase());
}

function passwordProblem(password) {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN_LENGTH) return "Use at least 8 characters.";
  if (value.length > PASSWORD_MAX_LENGTH) return "Use at most 128 characters.";
  if (isCommonPassword(value)) return "That password is too common. Choose one that is harder to guess.";
  return null;
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
    hasPassword: Boolean(row.password_hash),
    googleLinked: Boolean(row.google_sub),
    disabled: Boolean(row.disabled),
    locked: Number(row.failed_logins) >= LOCK_AFTER_FAILURES,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

class AccountError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function createAccountStore(knex, { now = () => new Date() } = {}) {
  const table = () => knex(ACCOUNTS_TABLE);

  async function rowByEmail(email) {
    return table().where({ email: normalizeEmail(email) }).first();
  }

  async function update(id, values) {
    await table().where({ id }).update({ ...values, updated_at: now() });
    return toAccount(await table().where({ id }).first());
  }

  return Object.freeze({
    async findById(id) {
      return toAccount(await table().where({ id: String(id ?? "") }).first());
    },

    async findByEmail(email) {
      return toAccount(await rowByEmail(email));
    },

    async findByGoogleSub(googleSub) {
      return toAccount(await table().where({ google_sub: String(googleSub ?? "") }).first());
    },

    async list() {
      return (await table().orderBy("created_at", "desc")).map(toAccount);
    },

    async create({ email, password = null, displayName = "", emailVerified = false, googleSub = null }) {
      const normalizedEmail = normalizeEmail(email);
      if (!isEmail(normalizedEmail)) {
        throw new AccountError("email_invalid", "Enter a valid email address.");
      }
      if (password !== null) {
        const problem = passwordProblem(password);
        if (problem) throw new AccountError("password_rejected", problem);
      }
      if (await rowByEmail(normalizedEmail)) {
        throw new AccountError("email_taken", "This email already has an account. Sign in, or reset its password.", 409);
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
    },

    /**
     * Checks an email and password. Unknown emails, wrong passwords, disabled
     * and locked accounts all fail the same way, so the caller shows one
     * generic sentence. A locked account stays locked until recovery, even
     * with the right password.
     */
    async authenticate(email, password) {
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
    },

    async checkPassword(id, password) {
      const row = await table().where({ id }).first();
      return Boolean(row?.password_hash) && verifyPassword(password, passwordRecord(row));
    },

    async setPassword(id, password) {
      const problem = passwordProblem(password);
      if (problem) throw new AccountError("password_rejected", problem);
      return update(id, { ...passwordColumns(await hashPassword(password)), failed_logins: 0 });
    },

    async clearPassword(id) {
      return update(id, {
        password_algorithm: null,
        password_version: null,
        password_salt: null,
        password_hash: null
      });
    },

    async updateProfile(id, { displayName }) {
      const name = String(displayName ?? "").trim();
      if (!name) throw new AccountError("display_name_required", "Enter the name your apps should show.");
      return update(id, { display_name: name.slice(0, 160) });
    },

    markEmailVerified(id) {
      return update(id, { email_verified: true });
    },

    linkGoogle(id, googleSub) {
      return update(id, { google_sub: String(googleSub) });
    },

    async unlinkGoogle(id) {
      const row = await table().where({ id }).first();
      if (!row?.password_hash) {
        throw new AccountError("password_required", "Set a password first, so you can still sign in without Google.");
      }
      return update(id, { google_sub: null });
    },

    setDisabled(id, disabled) {
      return update(id, { disabled: Boolean(disabled) });
    },

    /** Imports one exported JSKIT local account, keeping its id and scrypt fields byte for byte. */
    async importLocal(row) {
      const timestamp = now();
      await table().insert({
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
      });
    },

    async rawById(id) {
      return table().where({ id }).first();
    },

    rawByEmail: rowByEmail
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
