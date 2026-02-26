export default Object.freeze({
  packVersion: 2,
  packId: "db",
  version: "0.2.0",
  description: "Database capability pack. Choose one db-provider package.",
  options: {
    provider: {
      required: true,
      values: ["mysql", "postgres"]
    }
  },
  packages: [
    {
      packageId: "@jskit-ai/db-mysql",
      when: {
        option: "provider",
        equals: "mysql"
      }
    },
    {
      packageId: "@jskit-ai/db-postgres",
      when: {
        option: "provider",
        equals: "postgres"
      }
    }
  ]
});
