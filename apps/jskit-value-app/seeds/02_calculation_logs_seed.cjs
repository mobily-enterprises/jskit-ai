const USER_1_SUPABASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_2_SUPABASE_ID = "22222222-2222-4222-8222-222222222222";

exports.seed = async function seed(knex) {
  await knex("calculation_logs").del();

  const userProfiles = await knex("user_profiles")
    .select("id", "supabase_user_id")
    .whereIn("supabase_user_id", [USER_1_SUPABASE_ID, USER_2_SUPABASE_ID]);

  const bySupabaseId = new Map(userProfiles.map((row) => [row.supabase_user_id, row.id]));

  if (!bySupabaseId.has(USER_1_SUPABASE_ID) || !bySupabaseId.has(USER_2_SUPABASE_ID)) {
    throw new Error("Seed users are missing. Run users seed before calculation logs seed.");
  }

  const workspaces = await knex("workspaces")
    .select("id", "owner_user_id")
    .whereIn("owner_user_id", [bySupabaseId.get(USER_1_SUPABASE_ID), bySupabaseId.get(USER_2_SUPABASE_ID)])
    .andWhere({ is_personal: true });

  const workspaceByOwnerId = new Map(workspaces.map((row) => [Number(row.owner_user_id), Number(row.id)]));
  const user1WorkspaceId = workspaceByOwnerId.get(Number(bySupabaseId.get(USER_1_SUPABASE_ID)));
  const user2WorkspaceId = workspaceByOwnerId.get(Number(bySupabaseId.get(USER_2_SUPABASE_ID)));

  if (!user1WorkspaceId || !user2WorkspaceId) {
    throw new Error("Personal workspaces are missing. Run migrations before calculation logs seed.");
  }

  await knex("calculation_logs").insert([
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: user1WorkspaceId,
      user_id: bySupabaseId.get(USER_1_SUPABASE_ID),
      mode: "pv",
      timing: "ordinary",
      payment: "180.000000",
      annual_rate: "0.000000",
      annual_growth_rate: "0.000000",
      years: null,
      payments_per_year: 1,
      periodic_rate: "0.000000000000",
      periodic_growth_rate: "0.000000000000",
      total_periods: null,
      is_perpetual: false,
      value: "3.141592653590",
      deg2rad_operation: "DEG2RAD",
      deg2rad_formula: "DEG2RAD(x) = x * PI / 180",
      deg2rad_degrees: "180.000000000000",
      deg2rad_radians: "3.141592653590"
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: user2WorkspaceId,
      user_id: bySupabaseId.get(USER_2_SUPABASE_ID),
      mode: "pv",
      timing: "ordinary",
      payment: "90.000000",
      annual_rate: "0.000000",
      annual_growth_rate: "0.000000",
      years: null,
      payments_per_year: 1,
      periodic_rate: "0.000000000000",
      periodic_growth_rate: "0.000000000000",
      total_periods: null,
      is_perpetual: false,
      value: "1.570796326795",
      deg2rad_operation: "DEG2RAD",
      deg2rad_formula: "DEG2RAD(x) = x * PI / 180",
      deg2rad_degrees: "90.000000000000",
      deg2rad_radians: "1.570796326795"
    }
  ]);
};
