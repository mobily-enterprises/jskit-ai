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

  await knex("calculation_logs").insert([
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      user_id: bySupabaseId.get(USER_1_SUPABASE_ID),
      mode: "pv",
      timing: "ordinary",
      payment: "500.000000",
      annual_rate: "6.000000",
      annual_growth_rate: "0.000000",
      years: "20.0000",
      payments_per_year: 12,
      periodic_rate: "0.005000000000",
      periodic_growth_rate: "0.000000000000",
      total_periods: "240.0000",
      is_perpetual: false,
      value: "69809.043604199710"
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      user_id: bySupabaseId.get(USER_2_SUPABASE_ID),
      mode: "pv",
      timing: "due",
      payment: "500.000000",
      annual_rate: "6.000000",
      annual_growth_rate: "3.000000",
      years: null,
      payments_per_year: 12,
      periodic_rate: "0.005000000000",
      periodic_growth_rate: "0.002466269772",
      total_periods: null,
      is_perpetual: true,
      value: "98614.488440155450"
    }
  ]);
};
