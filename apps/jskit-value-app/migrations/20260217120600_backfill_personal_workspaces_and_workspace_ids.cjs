function toSlugPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildBaseWorkspaceSlug(userProfile) {
  const displayPart = toSlugPart(userProfile.display_name);
  if (displayPart) {
    return displayPart.slice(0, 90);
  }

  const emailLocalPart = String(userProfile.email || "").split("@")[0];
  const emailPart = toSlugPart(emailLocalPart);
  if (emailPart) {
    return emailPart.slice(0, 90);
  }

  return `user-${Number(userProfile.id)}`;
}

function buildWorkspaceName(userProfile) {
  const displayName = String(userProfile.display_name || "").trim();
  if (displayName) {
    return `${displayName} Workspace`.slice(0, 160);
  }

  const emailLocalPart = String(userProfile.email || "").split("@")[0];
  if (emailLocalPart) {
    return `${emailLocalPart} Workspace`.slice(0, 160);
  }

  return `Workspace ${Number(userProfile.id)}`.slice(0, 160);
}

function chooseUniqueSlug(baseSlug, usedSlugs) {
  const normalizedBase = toSlugPart(baseSlug) || "workspace";
  let candidate = normalizedBase;
  let suffix = 1;

  while (usedSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${normalizedBase}-${suffix}`;
  }

  usedSlugs.add(candidate);
  return candidate;
}

exports.up = async function up(knex) {
  const existingSlugsRows = await knex("workspaces").select("slug");
  const usedSlugs = new Set(existingSlugsRows.map((row) => toSlugPart(row.slug)).filter(Boolean));

  const userWorkspaceMap = new Map();
  const users = await knex("user_profiles").select("id", "display_name", "email").orderBy("id", "asc");

  await knex.transaction(async (trx) => {
    for (const user of users) {
      let workspace = await trx("workspaces")
        .where({ owner_user_id: user.id, is_personal: true })
        .orderBy("id", "asc")
        .first();

      if (!workspace) {
        const slug = chooseUniqueSlug(buildBaseWorkspaceSlug(user), usedSlugs);
        const [workspaceId] = await trx("workspaces").insert({
          slug,
          name: buildWorkspaceName(user),
          owner_user_id: user.id,
          is_personal: true
        });

        workspace = await trx("workspaces").where({ id: workspaceId }).first();
      } else {
        const normalizedSlug = toSlugPart(workspace.slug);
        if (normalizedSlug) {
          usedSlugs.add(normalizedSlug);
        }
      }

      await trx("workspace_memberships")
        .insert({
          workspace_id: workspace.id,
          user_id: user.id,
          role_id: "owner",
          status: "active"
        })
        .onConflict(["workspace_id", "user_id"])
        .ignore();

      await trx("workspace_settings")
        .insert({
          workspace_id: workspace.id,
          invites_enabled: false,
          features_json: JSON.stringify({}),
          policy_json: JSON.stringify({})
        })
        .onConflict(["workspace_id"])
        .ignore();

      const existingUserSettings = await trx("user_settings").where({ user_id: user.id }).first();
      if (!existingUserSettings) {
        await trx("user_settings").insert({
          user_id: user.id,
          last_active_workspace_id: workspace.id
        });
      } else if (!existingUserSettings.last_active_workspace_id) {
        await trx("user_settings")
          .where({ user_id: user.id })
          .update({
            last_active_workspace_id: workspace.id,
            updated_at: knex.raw("UTC_TIMESTAMP(3)")
          });
      }

      userWorkspaceMap.set(Number(user.id), Number(workspace.id));
    }

    for (const [userId, workspaceId] of userWorkspaceMap.entries()) {
      await trx("calculation_logs")
        .where({ user_id: userId })
        .whereNull("workspace_id")
        .update({ workspace_id: workspaceId });
    }
  });

  const unresolvedCountRow = await knex("calculation_logs").whereNull("workspace_id").count({ total: "*" }).first();
  const unresolvedCount = Number(Object.values(unresolvedCountRow || {})[0] || 0);
  if (unresolvedCount > 0) {
    throw new Error("Unable to backfill workspace_id for all calculation_logs rows.");
  }

  await knex.schema.alterTable("calculation_logs", (table) => {
    table.bigInteger("workspace_id").unsigned().notNullable().alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("calculation_logs", (table) => {
    table.bigInteger("workspace_id").unsigned().nullable().alter();
  });

  await knex("calculation_logs").update({
    workspace_id: null
  });

  await knex("user_settings").update({
    last_active_workspace_id: null,
    updated_at: knex.raw("UTC_TIMESTAMP(3)")
  });
};
