import { createRepository as createSettingsRepository } from "../../modules/settings/index.js";
import { createProjectsSettingsExtension } from "../settingsExtensions/projectsPreferences.server.js";

const { repository: settingsRepository } = createSettingsRepository();

export default createProjectsSettingsExtension({
  projectsSettingsRepository: settingsRepository
});
