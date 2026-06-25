import { normalizeTenancyMode, TENANCY_MODE_NONE, TENANCY_MODE_PERSONAL } from "../shared/tenancyMode.js";
import { resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { OWNER_ROLE_ID } from "../shared/roles.js";
import { resolveWorkspaceThemePalettes } from "../shared/settings.js";

const WORKSPACE_SLUG_MAX_LENGTH = 48;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeLowerText(value = "") {
  return normalizeText(value).toLowerCase();
}

function workspaceSlugPart(value = "") {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH);
  return normalized || "workspace";
}

function usernameBaseFromEmail(email = "") {
  const normalizedEmail = normalizeLowerText(email);
  const localPart = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail;
  return workspaceSlugPart(localPart) || "user";
}

function buildWorkspaceBaseSlug(profile = {}) {
  return workspaceSlugPart(profile.username || profile.displayName || usernameBaseFromEmail(profile.email));
}

function buildWorkspaceName(profile = {}) {
  const displayName = normalizeText(profile.displayName);
  if (displayName) {
    return `${displayName}'s Workspace`;
  }
  const email = normalizeLowerText(profile.email);
  return email ? `${email}'s Workspace` : "Workspace";
}

function buildWorkspaceSlugCandidate(baseSlug = "", suffix = 0) {
  const base = workspaceSlugPart(baseSlug);
  if (suffix < 1) {
    return base;
  }
  const suffixText = `-${suffix + 1}`;
  return `${base.slice(0, WORKSPACE_SLUG_MAX_LENGTH - suffixText.length)}${suffixText}`;
}

function isDuplicateError(error) {
  return (
    ["23505", "ER_DUP_ENTRY", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(error?.code || "")) ||
    Number(error?.errno) === 1062
  );
}

function normalizeWorkspaceResult(workspace = null) {
  if (!workspace) {
    return null;
  }
  return {
    id: normalizeText(workspace.id),
    slug: normalizeLowerText(workspace.slug)
  };
}

async function resolveUniqueWorkspaceSlug(db, baseSlug = "", { excludeWorkspaceId = "" } = {}) {
  const normalizedExcludeWorkspaceId = normalizeText(excludeWorkspaceId);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildWorkspaceSlugCandidate(baseSlug, suffix);
    const existing = await db("workspaces")
      .where({ slug: candidate })
      .first();
    if (!existing || normalizeText(existing.id) === normalizedExcludeWorkspaceId) {
      return candidate;
    }
  }
  throw new Error("Unable to generate unique preview workspace slug.");
}

async function hasWorkspaceTables(db) {
  return (
    (await db.schema.hasTable("workspaces")) &&
    (await db.schema.hasTable("workspace_memberships")) &&
    (await db.schema.hasTable("workspace_settings"))
  );
}

async function findPreviewWorkspace(db, user = {}, { isPersonal = true } = {}) {
  return db("workspaces")
    .where({
      owner_user_id: user.id,
      is_personal: isPersonal
    })
    .orderBy("id", "asc")
    .first();
}

async function ensureWorkspaceSettings(db, workspace = {}) {
  const existing = await db("workspace_settings")
    .where({ workspace_id: workspace.id })
    .first();
  if (existing) {
    return false;
  }

  const palettes = resolveWorkspaceThemePalettes({});
  try {
    await db("workspace_settings").insert({
      workspace_id: workspace.id,
      light_primary_color: palettes.light.color,
      light_secondary_color: palettes.light.secondaryColor,
      light_surface_color: palettes.light.surfaceColor,
      light_surface_variant_color: palettes.light.surfaceVariantColor,
      dark_primary_color: palettes.dark.color,
      dark_secondary_color: palettes.dark.secondaryColor,
      dark_surface_color: palettes.dark.surfaceColor,
      dark_surface_variant_color: palettes.dark.surfaceVariantColor,
      invites_enabled: true
    });
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
  return true;
}

async function ensureOwnerMembership(db, workspace = {}, user = {}) {
  const existing = await db("workspace_memberships")
    .where({
      workspace_id: workspace.id,
      user_id: user.id
    })
    .first();
  if (existing) {
    if (existing.role_sid !== OWNER_ROLE_ID || existing.status !== "active") {
      await db("workspace_memberships")
        .where({ id: existing.id })
        .update({
          role_sid: OWNER_ROLE_ID,
          status: "active",
          updated_at: new Date()
        });
      return true;
    }
    return false;
  }

  try {
    await db("workspace_memberships").insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role_sid: OWNER_ROLE_ID,
      status: "active"
    });
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
  return true;
}

async function ensurePreviewWorkspace(db, user = {}, profile = {}, { appConfig = {}, tenancyMode = "" } = {}) {
  if (!db || typeof db !== "function" || !db.schema || typeof db.schema.hasTable !== "function") {
    throw new TypeError("ensurePreviewWorkspace requires a Knex database instance.");
  }

  const resolvedTenancyMode = normalizeTenancyMode(tenancyMode || resolveTenancyProfile(appConfig).mode);
  if (resolvedTenancyMode === TENANCY_MODE_NONE) {
    return {
      workspace: null,
      skipped: "workspace tenancy is disabled"
    };
  }

  if (!(await hasWorkspaceTables(db))) {
    return {
      workspace: null,
      skipped: "workspace tables were not found"
    };
  }

  const isPersonal = resolvedTenancyMode === TENANCY_MODE_PERSONAL;
  let workspace = await findPreviewWorkspace(db, user, { isPersonal });
  if (!workspace) {
    const slug = await resolveUniqueWorkspaceSlug(db, buildWorkspaceBaseSlug(profile));
    try {
      await db("workspaces").insert({
        avatar_url: "",
        is_personal: isPersonal,
        name: buildWorkspaceName(profile),
        owner_user_id: user.id,
        slug
      });
    } catch (error) {
      if (!isDuplicateError(error)) {
        throw error;
      }
    }
    workspace = await db("workspaces")
      .where({ slug })
      .first();
  }

  if (!workspace) {
    throw new Error("Preview workspace could not be inserted or found.");
  }

  await ensureOwnerMembership(db, workspace, user);
  await ensureWorkspaceSettings(db, workspace);

  return {
    workspace: normalizeWorkspaceResult(workspace),
    skipped: ""
  };
}

export {
  buildWorkspaceBaseSlug,
  buildWorkspaceName,
  ensurePreviewWorkspace,
  normalizeWorkspaceResult
};
