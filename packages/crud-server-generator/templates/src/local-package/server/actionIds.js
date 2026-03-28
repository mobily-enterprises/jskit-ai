const actionIds = Object.freeze({
  list: "crud.${option:namespace|snake}.list",
  view: "crud.${option:namespace|snake}.view",
  create: "crud.${option:namespace|snake}.create",
  update: "crud.${option:namespace|snake}.update",
  delete: "crud.${option:namespace|snake}.delete"
});

export { actionIds };
