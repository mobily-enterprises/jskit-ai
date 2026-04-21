const LIST_CONFIG = Object.freeze({
  searchColumns: ["display_name", "email", "username"],
  orderBy: [
    {
      column: "display_name",
      direction: "asc",
      nulls: "last"
    },
    {
      column: "email",
      direction: "asc"
    }
  ]
});

export { LIST_CONFIG };
