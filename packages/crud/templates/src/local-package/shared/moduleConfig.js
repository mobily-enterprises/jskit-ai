const crudModuleConfig = Object.freeze({
  namespace: "${option:namespace|snake}",
  visibility: "${option:visibility}",
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab}"
});

export { crudModuleConfig };
