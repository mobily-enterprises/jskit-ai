exports.seed = async function seed(knex) {
  await knex("jskit_placeholder").del();
  await knex("jskit_placeholder").insert([
    {
      label: "seeded-by-jskit-db-pack"
    }
  ]);
};
