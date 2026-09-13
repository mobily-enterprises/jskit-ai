import { microsoftPowerPointDefinition } from "../shared/microsoft.js";
import { microsoftDocumentProvider } from "./microsoft.js";

const microsoftPowerPointProvider = microsoftDocumentProvider(microsoftPowerPointDefinition, ["ppt", "pptx", "pptm", "pot", "potx", "potm", "pps", "ppsx", "ppsm"]);
export { microsoftPowerPointProvider };
