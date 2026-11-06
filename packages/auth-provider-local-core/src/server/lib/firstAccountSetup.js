import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { sha256Base64url } from "./tokens.js";

// The file in AUTH_LOCAL_STORE_DIR that holds the code while it is needed.
const SETUP_CODE_FILE = "first-account-setup-code";
// The variable in which a hosting tool may supply the code itself.
const SETUP_CODE_ENV = "AUTH_LOCAL_SETUP_CODE";
// A supplied code needs at least this many letters and digits, as many as a code made here.
const SETUP_CODE_MIN_CHARACTERS = 20;
// Crockford's base32: no I, L, O or U, so a code read aloud or retyped stays exact.
const SETUP_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SETUP_CODE_LENGTH = 20;

function newSetupCode() {
  const characters = Array.from(randomBytes(SETUP_CODE_LENGTH), (byte) => SETUP_CODE_ALPHABET[byte % 32]);
  return characters.join("").match(/.{5}/gu).join("-");
}

// Letter case, spaces, dashes and other punctuation do not matter.
function normalizedSetupCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-Z]/gu, "");
}

function setupCodeHash(code) {
  return sha256Base64url(normalizedSetupCode(code));
}

function setupCodeRequired() {
  return new AppError(403, "This app has no account yet. Its first account needs the setup code from the server's log or its hosting service.", {
    code: "auth.local.setup.codeRequired"
  });
}

function setupCodeInvalid() {
  return new AppError(403, "That is not this app's setup code. Copy it again from the server's log or its hosting service.", {
    code: "auth.local.setup.codeInvalid"
  });
}

/**
 * The first account of a production server. While local auth has no account,
 * creating one needs a one-time setup code that only the server's operator can
 * read: each start of an ownerless production server makes a new code, writes
 * it in the log and in `first-account-setup-code` in AUTH_LOCAL_STORE_DIR, and
 * keeps only its hash. A hosting tool that supplies the code in
 * AUTH_LOCAL_SETUP_CODE shows it to the operator itself: the server then uses
 * that code at every start, and neither logs nor writes it. The code admits
 * registrations until an account exists, then stops working and its file is
 * deleted. Development needs no code.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 */
function createFirstAccountSetup({ backend, config, logger }) {
  const codeFile = path.join(config.storeDir, SETUP_CODE_FILE);
  let codeHash = null;
  let started = null;

  // The file only hands the code to the operator, and the log has it too, so
  // a store directory that cannot be written does not stop the server.
  function writeCodeFile(code) {
    try {
      fs.mkdirSync(config.storeDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(codeFile, `${code}\n`, { mode: 0o600 });
      fs.chmodSync(codeFile, 0o600);
      return codeFile;
    } catch (error) {
      logger.warn({ error: error.message, firstAccountSetupCodeFile: codeFile }, "Local auth could not write its setup code file.");
      return "";
    }
  }

  function removeCodeFile() {
    try {
      fs.rmSync(codeFile, { force: true });
    } catch (error) {
      logger.warn({ error: error.message, firstAccountSetupCodeFile: codeFile }, "Local auth could not delete its setup code file.");
    }
  }

  function finish() {
    codeHash = null;
    removeCodeFile();
  }

  async function prepare() {
    if (await backend.withTransaction((tx) => tx.users.hasAny())) {
      finish();
      return;
    }
    if (config.setupCode) {
      // The hosting tool shows its code, so a file left by an earlier start would only mislead.
      codeHash = setupCodeHash(config.setupCode);
      removeCodeFile();
      logger.warn(
        { firstAccountSetupCodeEnv: SETUP_CODE_ENV },
        `Local auth has no account yet: register the first account with the setup code in ${SETUP_CODE_ENV}.`
      );
      return;
    }
    const code = newSetupCode();
    codeHash = setupCodeHash(code);
    logger.warn(
      { firstAccountSetupCode: code, firstAccountSetupCodeFile: writeCodeFile(code) },
      "Local auth has no account yet: register the first account with this setup code."
    );
  }

  /**
   * Checks for an account once, when the server starts; outside production,
   * there is nothing to check. Later calls answer the same check.
   */
  function start() {
    if (!config.isProduction) {
      return Promise.resolve();
    }
    started ??= prepare().catch((error) => {
      started = null;
      throw error;
    });
    return started;
  }

  async function admitIn(tx, setupCode) {
    if (await tx.users.hasAny()) {
      finish();
      return;
    }
    if (!String(setupCode || "").trim()) {
      throw setupCodeRequired();
    }
    if (setupCodeHash(setupCode) !== codeHash) {
      throw setupCodeInvalid();
    }
  }

  /**
   * Refuses a registration while the first account needs its setup code and
   * `setupCode` is not it.
   * @param {unknown} setupCode
   */
  async function admitRegistration(setupCode) {
    await start();
    if (codeHash !== null) {
      await backend.withTransaction((tx) => admitIn(tx, setupCode));
    }
  }

  /**
   * Refuses, in the transaction that would create it, an account made by an
   * OAuth sign-in while the first account needs its setup code: that account
   * registers by password. Call `start()` before the transaction.
   * @param {import("../types.js").AuthLocalBackendTransaction} tx
   */
  async function admitOAuthAccount(tx) {
    if (codeHash !== null) {
      await admitIn(tx, "");
    }
  }

  /** Called once this server has created an account: the code stops working. */
  function accountCreated() {
    if (codeHash !== null) {
      finish();
    }
  }

  /** True while the first account needs the setup code, as far as this server knows. */
  function isWaiting() {
    return codeHash !== null;
  }

  return Object.freeze({
    start,
    admitRegistration,
    admitOAuthAccount,
    accountCreated,
    isWaiting
  });
}

export { SETUP_CODE_ENV, SETUP_CODE_FILE, SETUP_CODE_MIN_CHARACTERS, createFirstAccountSetup, normalizedSetupCode };
