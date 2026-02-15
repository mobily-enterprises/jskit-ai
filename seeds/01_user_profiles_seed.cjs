const SEEDED_USERS = [
  {
    supabase_user_id: "11111111-1111-4111-8111-111111111111",
    email: "seed.user1@example.com",
    display_name: "seed.user1"
  },
  {
    supabase_user_id: "22222222-2222-4222-8222-222222222222",
    email: "seed.user2@example.com",
    display_name: "seed.user2"
  }
];

exports.seed = async function seed(knex) {
  await knex("user_profiles").del();
  await knex("user_profiles").insert(SEEDED_USERS);
};
