export default {
  id: "brokenDependencyExtension",
  version: "0.1.0",
  tier: "extension",
  dependsOnModules: [
    {
      id: "missingCoreModule",
      range: "^0.1.0"
    }
  ],
  contributions: {
    actionContributorModules: ["workspace"]
  }
};
