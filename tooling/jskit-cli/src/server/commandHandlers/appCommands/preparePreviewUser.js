import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

const TENANCY_MODE_NONE = "none";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeLowerText(value = "") {
  return normalizeText(value).toLowerCase();
}

function profileFromOptions(options = {}) {
  const inlineOptions = options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {};
  const profile = {};

  const email = normalizeLowerText(inlineOptions.email || process.env.JSKIT_PREVIEW_USER_EMAIL);
  const authProvider = normalizeLowerText(inlineOptions["auth-provider"] || process.env.JSKIT_PREVIEW_AUTH_PROVIDER);
  const username = normalizeLowerText(inlineOptions.username || process.env.JSKIT_PREVIEW_USER_USERNAME);
  const displayName = normalizeText(inlineOptions["display-name"] || process.env.JSKIT_PREVIEW_USER_DISPLAY_NAME);
  const authProviderUserSid = normalizeText(
    inlineOptions["auth-provider-user-sid"] || process.env.JSKIT_PREVIEW_AUTH_PROVIDER_USER_SID
  );

  if (authProvider) {
    profile.authProvider = authProvider;
  }
  if (authProviderUserSid) {
    profile.authProviderUserSid = authProviderUserSid;
  }
  if (displayName) {
    profile.displayName = displayName;
  }
  if (email) {
    profile.email = email;
  }
  if (username) {
    profile.username = username;
  }

  return profile;
}

async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createAppRequire(appRoot = "") {
  return createRequire(path.join(appRoot, "package.json"));
}

async function importFreshModule(filePath = "") {
  return import(`${pathToFileURL(filePath).href}?mtime=${Date.now()}`);
}

async function loadKnexConfig(appRoot = "") {
  const knexfilePath = path.join(appRoot, "knexfile.js");
  if (!(await fileExists(knexfilePath))) {
    return null;
  }

  const requireFromApp = createAppRequire(appRoot);
  const moduleValue = requireFromApp("knex");
  const createKnex =
    typeof moduleValue === "function"
      ? moduleValue
      : typeof moduleValue?.default === "function"
        ? moduleValue.default
        : null;
  if (!createKnex) {
    throw new Error("App-local knex package resolved but did not expose a callable factory.");
  }

  const knexfileModule = await importFreshModule(knexfilePath);
  const exported = knexfileModule.default || knexfileModule.config || knexfileModule;
  const knexfile = typeof exported === "function" ? await exported() : exported;
  const environment = normalizeText(process.env.NODE_ENV) || "development";

  return {
    createKnex,
    knexConfig: knexfile?.[environment] || knexfile
  };
}

async function importAppPackageExport(appRoot = "", specifier = "", { required = true } = {}) {
  const requireFromApp = createAppRequire(appRoot);
  let resolvedPath = "";
  try {
    resolvedPath = requireFromApp.resolve(specifier);
  } catch {
    if (!required) {
      return null;
    }
    throw new Error(
      `Unable to load app-local ${specifier}. Upgrade the installed JSKIT package that owns this preview provisioning contract.`
    );
  }
  return importFreshModule(resolvedPath);
}

async function writeProfile(profileFile = "", authProfile = {}) {
  if (!profileFile) {
    return false;
  }
  await mkdir(path.dirname(profileFile), { recursive: true });
  await writeFile(profileFile, `${JSON.stringify(authProfile, null, 2)}\n`, "utf8");
  return true;
}

function isTrueOption(value) {
  const normalized = normalizeLowerText(value);
  return value === true || normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeTenancyMode(value = "") {
  const normalized = normalizeLowerText(value);
  return normalized === "personal" || normalized === "workspaces" ? normalized : TENANCY_MODE_NONE;
}

async function hasWorkspaceTables(db) {
  return (
    (await db.schema.hasTable("workspaces")) &&
    (await db.schema.hasTable("workspace_memberships")) &&
    (await db.schema.hasTable("workspace_settings"))
  );
}

async function runAppPreparePreviewUserCommand(_ctx = {}, { appRoot = "", options = {}, stdout = process.stdout }) {
  const inlineOptions = options?.inlineOptions && typeof options.inlineOptions === "object" ? options.inlineOptions : {};
  const profileFile = normalizeText(inlineOptions["profile-file"] || process.env.VIBE64_PREVIEW_AUTH_PROFILE_FILE);
  const ensureWorkspace = isTrueOption(inlineOptions["ensure-workspace"]);
  const loadedKnex = await loadKnexConfig(appRoot);
  if (!loadedKnex) {
    stdout.write("[jskit:preview] skipped: knexfile.js was not found.\n");
    return 0;
  }

  const db = loadedKnex.createKnex(loadedKnex.knexConfig);
  try {
    if (!(await db.schema.hasTable("users"))) {
      stdout.write("[jskit:preview] skipped: users table was not found.\n");
      return 0;
    }

    const usersPreviewModule = await importAppPackageExport(
      appRoot,
      "@jskit-ai/users-core/server/previewUserProvisioning"
    );
    if (typeof usersPreviewModule?.ensurePreviewUser !== "function") {
      throw new Error("@jskit-ai/users-core preview provisioning export is missing ensurePreviewUser().");
    }

    const userResult = await usersPreviewModule.ensurePreviewUser(db, profileFromOptions(options));
    if (userResult?.skipped) {
      stdout.write(`[jskit:preview] skipped: ${userResult.skipped}.\n`);
      return 0;
    }

    const authProfile = userResult.profile;
    let workspace = null;

    if (ensureWorkspace) {
      const appConfig = await loadAppConfigFromAppRoot({ appRoot });
      const tenancyMode = normalizeTenancyMode(appConfig?.tenancyMode);
      if (tenancyMode === TENANCY_MODE_NONE) {
        stdout.write("[jskit:preview] skipped workspace: workspace tenancy is disabled.\n");
      } else if (!(await hasWorkspaceTables(db))) {
        throw new Error(
          `Workspace tenancy is "${tenancyMode}", but workspace tables were not found. Run migrations before prepare-preview-user.`
        );
      } else {
        const workspacesPreviewModule = await importAppPackageExport(
          appRoot,
          "@jskit-ai/workspaces-core/server/previewWorkspaceProvisioning"
        );
        if (typeof workspacesPreviewModule?.ensurePreviewWorkspace !== "function") {
          throw new Error("@jskit-ai/workspaces-core preview provisioning export is missing ensurePreviewWorkspace().");
        }

        const workspaceResult = await workspacesPreviewModule.ensurePreviewWorkspace(db, userResult.user, authProfile, {
          appConfig,
          tenancyMode
        });
        workspace = workspaceResult?.workspace || null;
        if (workspaceResult?.skipped) {
          stdout.write(`[jskit:preview] skipped workspace: ${workspaceResult.skipped}.\n`);
        }
      }
    }

    const outputProfile = {
      ...authProfile,
      ...(workspace ? { workspace } : {})
    };
    await writeProfile(profileFile, outputProfile);
    stdout.write(`[jskit:preview] user is ready: ${outputProfile.email} (${outputProfile.id}).\n`);
    if (workspace) {
      stdout.write(`[jskit:preview] workspace is ready: ${workspace.slug} (${workspace.id}).\n`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

export { runAppPreparePreviewUserCommand };
