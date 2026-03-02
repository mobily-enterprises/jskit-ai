import * as socialRepositoryModule from "./social.repository.js";
import { createRepositoryExport } from "../../moduleExports.js";

const repository = { ...socialRepositoryModule };
delete repository.__testables;

function createRepository() {
  return createRepositoryExport(repository);
}

export { createRepository };
