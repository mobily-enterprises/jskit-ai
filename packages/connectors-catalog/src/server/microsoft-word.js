import { microsoftWordDefinition } from "../shared/microsoft.js";
import { microsoftDocumentProvider } from "./microsoft.js";

const microsoftWordProvider = microsoftDocumentProvider(microsoftWordDefinition, ["doc", "docx", "docm", "dot", "dotx", "dotm"]);
export { microsoftWordProvider };
