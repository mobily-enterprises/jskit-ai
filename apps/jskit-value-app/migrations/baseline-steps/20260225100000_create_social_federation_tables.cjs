exports.up = async function up(knex) {
  const nowDefault = knex.fn.now();

  await knex.schema.createTable("social_actors", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("user_id").unsigned().nullable();
    table.string("public_chat_id", 64).nullable();
    table.string("username", 64).notNullable();
    table.string("display_name", 160).notNullable().defaultTo("");
    table.text("summary_text", "longtext").notNullable();
    table.string("actor_uri", 512).notNullable();
    table.string("inbox_url", 512).nullable();
    table.string("shared_inbox_url", 512).nullable();
    table.string("outbox_url", 512).nullable();
    table.string("followers_url", 512).nullable();
    table.string("following_url", 512).nullable();
    table.string("object_uri", 512).nullable();
    table.boolean("is_local").notNullable().defaultTo(false);
    table.boolean("is_suspended").notNullable().defaultTo(false);
    table.dateTime("last_fetched_at", { useTz: false }).nullable();
    table.text("raw_json", "longtext").notNullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["workspace_id", "actor_uri"], "uq_soc_actors_ws_actor_uri");
    table.unique(["workspace_id", "username"], "uq_soc_actors_ws_username");
    table.unique(["workspace_id", "user_id"], "uq_soc_actors_ws_user");
    table.unique(["workspace_id", "public_chat_id"], "uq_soc_actors_ws_public_chat");
    table.index(["workspace_id", "is_local"], "idx_soc_actors_ws_local");
    table.index(["workspace_id", "updated_at"], "idx_soc_actors_ws_updated");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
  });

  await knex.schema.createTable("social_actor_keys", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("actor_id").unsigned().notNullable();
    table.string("key_id", 512).notNullable();
    table.text("public_key_pem", "longtext").notNullable();
    table.text("private_key_encrypted", "longtext").notNullable();
    table.string("key_algorithm", 64).notNullable().defaultTo("rsa-sha256");
    table.dateTime("rotated_at", { useTz: false }).nullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["workspace_id", "key_id"], "uq_soc_actor_keys_ws_key");
    table.index(["workspace_id", "actor_id", "created_at"], "idx_soc_actor_keys_ws_actor_created");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("actor_id").references("id").inTable("social_actors").onDelete("CASCADE");
  });

  await knex.schema.createTable("social_posts", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("actor_id").unsigned().notNullable();
    table.string("object_uri", 512).notNullable();
    table.string("activity_uri", 512).nullable();
    table.bigInteger("in_reply_to_post_id").unsigned().nullable();
    table.string("in_reply_to_object_uri", 512).nullable();
    table.string("visibility", 32).notNullable().defaultTo("public");
    table.text("content_text", "longtext").notNullable();
    table.text("content_html", "longtext").nullable();
    table.string("language", 16).nullable();
    table.boolean("is_local").notNullable().defaultTo(true);
    table.boolean("is_deleted").notNullable().defaultTo(false);
    table.integer("like_count").unsigned().notNullable().defaultTo(0);
    table.integer("announce_count").unsigned().notNullable().defaultTo(0);
    table.integer("reply_count").unsigned().notNullable().defaultTo(0);
    table.dateTime("published_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("edited_at", { useTz: false }).nullable();
    table.dateTime("deleted_at", { useTz: false }).nullable();
    table.text("raw_json", "longtext").notNullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["workspace_id", "object_uri"], "uq_soc_posts_ws_object_uri");
    table.unique(["workspace_id", "activity_uri"], "uq_soc_posts_ws_activity_uri");
    table.index(["workspace_id", "actor_id", "id"], "idx_soc_posts_ws_actor_id");
    table.index(["workspace_id", "in_reply_to_post_id", "id"], "idx_soc_posts_ws_reply_id");
    table.index(["workspace_id", "is_deleted", "id"], "idx_soc_posts_ws_deleted_id");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("actor_id").references("id").inTable("social_actors").onDelete("CASCADE");
    table.foreign("in_reply_to_post_id").references("id").inTable("social_posts").onDelete("SET NULL");
  });

  await knex.schema.createTable("social_post_attachments", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("post_id").unsigned().notNullable();
    table.string("media_kind", 32).notNullable().defaultTo("attachment");
    table.string("mime_type", 160).nullable();
    table.string("url", 1024).notNullable();
    table.string("preview_url", 1024).nullable();
    table.string("description", 500).nullable();
    table.integer("width").unsigned().nullable();
    table.integer("height").unsigned().nullable();
    table.integer("size_bytes").unsigned().nullable();
    table.integer("sort_order").unsigned().notNullable().defaultTo(0);
    table.text("raw_json", "longtext").notNullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["post_id", "sort_order"], "uq_soc_post_atts_post_order");
    table.index(["workspace_id", "post_id"], "idx_soc_post_atts_ws_post");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("post_id").references("id").inTable("social_posts").onDelete("CASCADE");
  });

  await knex.schema.createTable("social_follows", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("follower_actor_id").unsigned().notNullable();
    table.bigInteger("target_actor_id").unsigned().notNullable();
    table.string("follow_uri", 512).notNullable();
    table.string("status", 32).notNullable().defaultTo("pending");
    table.boolean("is_local_initiated").notNullable().defaultTo(true);
    table.dateTime("accepted_at", { useTz: false }).nullable();
    table.dateTime("rejected_at", { useTz: false }).nullable();
    table.dateTime("undone_at", { useTz: false }).nullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["workspace_id", "follower_actor_id", "target_actor_id"], "uq_soc_follows_ws_pair");
    table.unique(["workspace_id", "follow_uri"], "uq_soc_follows_ws_uri");
    table.index(["workspace_id", "target_actor_id", "status", "id"], "idx_soc_follows_ws_target");
    table.index(["workspace_id", "follower_actor_id", "status", "id"], "idx_soc_follows_ws_follower");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("follower_actor_id").references("id").inTable("social_actors").onDelete("CASCADE");
    table.foreign("target_actor_id").references("id").inTable("social_actors").onDelete("CASCADE");
  });

  await knex.schema.createTable("social_inbox_events", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.string("activity_id", 512).notNullable();
    table.string("activity_type", 64).notNullable();
    table.string("actor_uri", 512).notNullable();
    table.string("signature_key_id", 512).nullable();
    table.boolean("signature_valid").notNullable().defaultTo(false);
    table.boolean("digest_valid").notNullable().defaultTo(false);
    table.text("payload_json", "longtext").notNullable();
    table.dateTime("received_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("processed_at", { useTz: false }).nullable();
    table.string("processing_status", 32).notNullable().defaultTo("received");
    table.string("processing_error", 1024).nullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["workspace_id", "activity_id"], "uq_soc_inbox_ws_activity");
    table.index(["workspace_id", "processing_status", "received_at"], "idx_soc_inbox_ws_status_recv");
    table.index(["workspace_id", "actor_uri", "id"], "idx_soc_inbox_ws_actor_id");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
  });

  await knex.schema.createTable("social_outbox_deliveries", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("actor_id").unsigned().notNullable();
    table.bigInteger("target_actor_id").unsigned().nullable();
    table.string("target_inbox_url", 1024).notNullable();
    table.string("activity_id", 512).notNullable();
    table.string("activity_type", 64).notNullable();
    table.text("payload_json", "longtext").notNullable();
    table.string("dedupe_key", 255).notNullable();
    table.string("status", 32).notNullable().defaultTo("queued");
    table.integer("attempt_count").unsigned().notNullable().defaultTo(0);
    table.integer("max_attempts").unsigned().notNullable().defaultTo(8);
    table.dateTime("next_attempt_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("last_attempt_at", { useTz: false }).nullable();
    table.dateTime("delivered_at", { useTz: false }).nullable();
    table.integer("last_http_status").unsigned().nullable();
    table.string("last_error", 1024).nullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.unique(["workspace_id", "dedupe_key"], "uq_soc_outbox_ws_dedupe");
    table.index(["workspace_id", "status", "next_attempt_at", "id"], "idx_soc_outbox_ws_status_next");
    table.index(["workspace_id", "actor_id", "id"], "idx_soc_outbox_ws_actor_id");
    table.index(["workspace_id", "target_actor_id", "id"], "idx_soc_outbox_ws_target_id");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("actor_id").references("id").inTable("social_actors").onDelete("CASCADE");
    table.foreign("target_actor_id").references("id").inTable("social_actors").onDelete("SET NULL");
  });

  await knex.schema.createTable("social_notifications", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("user_id").unsigned().notNullable();
    table.bigInteger("actor_id").unsigned().nullable();
    table.bigInteger("post_id").unsigned().nullable();
    table.string("notification_type", 64).notNullable();
    table.text("payload_json", "longtext").notNullable();
    table.boolean("is_read").notNullable().defaultTo(false);
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("read_at", { useTz: false }).nullable();

    table.index(["workspace_id", "user_id", "is_read", "id"], "idx_soc_notifs_ws_user_read_id");
    table.index(["workspace_id", "user_id", "id"], "idx_soc_notifs_ws_user_id");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    table.foreign("actor_id").references("id").inTable("social_actors").onDelete("SET NULL");
    table.foreign("post_id").references("id").inTable("social_posts").onDelete("SET NULL");
  });

  await knex.schema.createTable("social_moderation_rules", (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.string("rule_scope", 32).notNullable();
    table.string("domain", 255).nullable();
    table.string("actor_uri", 512).nullable();
    table.string("decision", 32).notNullable();
    table.string("reason", 500).nullable();
    table.bigInteger("created_by_user_id").unsigned().nullable();
    table.dateTime("created_at", { useTz: false }).notNullable().defaultTo(nowDefault);
    table.dateTime("updated_at", { useTz: false }).notNullable().defaultTo(nowDefault);

    table.index(["workspace_id", "decision", "rule_scope", "id"], "idx_soc_mod_rules_ws_dec_scope");
    table.index(["workspace_id", "domain"], "idx_soc_mod_rules_ws_domain");
    table.index(["workspace_id", "actor_uri"], "idx_soc_mod_rules_ws_actor_uri");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("created_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("social_moderation_rules");
  await knex.schema.dropTableIfExists("social_notifications");
  await knex.schema.dropTableIfExists("social_outbox_deliveries");
  await knex.schema.dropTableIfExists("social_inbox_events");
  await knex.schema.dropTableIfExists("social_follows");
  await knex.schema.dropTableIfExists("social_post_attachments");
  await knex.schema.dropTableIfExists("social_posts");
  await knex.schema.dropTableIfExists("social_actor_keys");
  await knex.schema.dropTableIfExists("social_actors");
};
