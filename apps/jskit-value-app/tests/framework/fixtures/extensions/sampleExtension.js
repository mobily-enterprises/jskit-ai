export default {
  id: "sampleExtension",
  version: "0.1.0",
  tier: "extension",
  dependsOnModules: [
    {
      id: "workspace",
      range: "^0.1.0"
    }
  ],
  requiresCapabilities: [
    {
      id: "cap.workspace.selection",
      range: "^1.0.0"
    }
  ],
  contributions: {
    actionContributorModules: ["workspace"]
  }
};
