const FORMATTER_TAG = "docs.examples.02.tag.formatters";
const RESOLVE_TAG_REPORT = "docs.examples.02.resolveTag.report";

class ResolveTagExampleProvider {
  static id = "docs.examples.02.resolveTag";

  static dependsOn = ["docs.examples.02.tag"];

  register() {}

  boot(app) {
    const formatters = app.resolveTag(FORMATTER_TAG);
    const sample = "HeLLo";

    app.instance(RESOLVE_TAG_REPORT, {
      formatterCount: formatters.length,
      output: formatters.map((formatter) => ({
        id: formatter.id,
        value: formatter.format(sample)
      }))
    });
  }
}

export { ResolveTagExampleProvider };
