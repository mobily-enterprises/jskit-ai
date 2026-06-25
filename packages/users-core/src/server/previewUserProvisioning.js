import { DEFAULT_USER_SETTINGS } from "../shared/settings.js";

const DEFAULT_AUTH_PROVIDER = "jskit-preview";
const DEFAULT_EMAIL = "preview@jskit.local";
const DEFAULT_DISPLAY_NAME = "JSKIT Preview";
const USERNAME_MAX_LENGTH = 120;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeLowerText(value = "") {
  return normalizeText(value).toLowerCase();
}

function normalizeUsername(value = "") {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
  return normalized || "";
}

function usernameBaseFromEmail(email = "") {
  const normalizedEmail = normalizeLowerText(email);
  const localPart = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail;
  return normalizeUsername(localPart) || "user";
}

function buildUsernameCandidate(baseUsername = "", suffix = 0) {
  const base = normalizeUsername(baseUsername) || "user";
  if (suffix < 1) {
    return base;
  }
  const suffixText = `-${suffix + 1}`;
  return `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
}

function isDuplicateError(error) {
  return (
    ["23505", "ER_DUP_ENTRY", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(error?.code || "")) ||
    Number(error?.errno) === 1062
  );
}

function normalizePreviewUserProfile(profile = {}) {
  const email = normalizeLowerText(profile.email || DEFAULT_EMAIL);
  const authProvider = normalizeLowerText(profile.authProvider || DEFAULT_AUTH_PROVIDER);
  const username = normalizeUsername(profile.username || usernameBaseFromEmail(email));

  return {
    authProvider,
    authProviderUserSid: normalizeText(profile.authProviderUserSid || `${authProvider}:${email}`),
    displayName: normalizeText(profile.displayName || username || email || DEFAULT_DISPLAY_NAME),
    email,
    username: username || usernameBaseFromEmail(email)
  };
}

function profileFromUserRow(user = {}, fallback = {}) {
  return {
    id: normalizeText(user.id),
    authProvider: normalizeLowerText(user.auth_provider || fallback.authProvider || DEFAULT_AUTH_PROVIDER),
    authProviderUserSid: normalizeText(user.auth_provider_user_sid || fallback.authProviderUserSid || user.id || ""),
    displayName: normalizeText(user.display_name || fallback.displayName || fallback.email || DEFAULT_DISPLAY_NAME),
    email: normalizeLowerText(user.email || fallback.email || DEFAULT_EMAIL),
    username: normalizeUsername(user.username || fallback.username || usernameBaseFromEmail(fallback.email))
  };
}

async function resolveUniqueUsername(db, baseUsername = "", { excludeUserId = "" } = {}) {
  const normalizedExcludeUserId = normalizeText(excludeUserId);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildUsernameCandidate(baseUsername, suffix);
    const existing = await db("users")
      .where({ username: candidate })
      .first();
    if (!existing || normalizeText(existing.id) === normalizedExcludeUserId) {
      return candidate;
    }
  }
  throw new Error("Unable to generate unique preview username.");
}

async function findPreviewUser(db, profile = {}) {
  if (profile.email) {
    const byEmail = await db("users")
      .where({ email: profile.email })
      .first();
    if (byEmail) {
      return byEmail;
    }
  }
  return db("users")
    .where({
      auth_provider: profile.authProvider,
      auth_provider_user_sid: profile.authProviderUserSid
    })
    .first();
}

async function ensurePreviewUserRow(db, profile = {}) {
  const existing = await findPreviewUser(db, profile);
  const username = await resolveUniqueUsername(db, profile.username, {
    excludeUserId: existing?.id
  });
  const record = {
    auth_provider: profile.authProvider,
    auth_provider_user_sid: profile.authProviderUserSid,
    display_name: profile.displayName,
    email: profile.email,
    username
  };

  if (existing) {
    await db("users")
      .where({ id: existing.id })
      .update(record);
    return db("users")
      .where({ id: existing.id })
      .first();
  }

  try {
    await db("users").insert(record);
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }

  const inserted = await findPreviewUser(db, {
    ...profile,
    username
  });
  if (!inserted) {
    throw new Error("Preview auth profile could not be inserted or found.");
  }
  return inserted;
}

async function ensureUserSettings(db, user = {}) {
  if (!(await db.schema.hasTable("user_settings"))) {
    return false;
  }
  const userId = user?.id;
  const existing = await db("user_settings")
    .where({ user_id: userId })
    .first();
  if (existing) {
    return false;
  }
  try {
    await db("user_settings").insert({
      user_id: userId,
      theme: DEFAULT_USER_SETTINGS.theme,
      locale: DEFAULT_USER_SETTINGS.locale,
      time_zone: DEFAULT_USER_SETTINGS.timeZone,
      date_format: DEFAULT_USER_SETTINGS.dateFormat,
      number_format: DEFAULT_USER_SETTINGS.numberFormat,
      currency_code: DEFAULT_USER_SETTINGS.currencyCode,
      avatar_size: DEFAULT_USER_SETTINGS.avatarSize,
      password_sign_in_enabled: DEFAULT_USER_SETTINGS.passwordSignInEnabled,
      password_setup_required: DEFAULT_USER_SETTINGS.passwordSetupRequired,
      notify_product_updates: DEFAULT_USER_SETTINGS.productUpdates,
      notify_account_activity: DEFAULT_USER_SETTINGS.accountActivity,
      notify_security_alerts: DEFAULT_USER_SETTINGS.securityAlerts
    });
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
  return true;
}

async function ensurePreviewUser(db, profileInput = {}) {
  if (!db || typeof db !== "function" || !db.schema || typeof db.schema.hasTable !== "function") {
    throw new TypeError("ensurePreviewUser requires a Knex database instance.");
  }
  if (!(await db.schema.hasTable("users"))) {
    return {
      user: null,
      profile: null,
      skipped: "users table was not found"
    };
  }

  const profile = normalizePreviewUserProfile(profileInput);
  const user = await ensurePreviewUserRow(db, profile);
  await ensureUserSettings(db, user);

  return {
    user,
    profile: profileFromUserRow(user, profile),
    skipped: ""
  };
}

export {
  DEFAULT_AUTH_PROVIDER,
  DEFAULT_DISPLAY_NAME,
  DEFAULT_EMAIL,
  ensurePreviewUser,
  normalizePreviewUserProfile,
  profileFromUserRow
};
