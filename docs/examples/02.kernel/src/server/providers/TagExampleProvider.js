const FORMATTER_UPPER = "docs.examples.02.tag.formatter.upper";
const FORMATTER_LOWER = "docs.examples.02.tag.formatter.lower";
const FORMATTER_TAG = "docs.examples.02.tag.formatters";
const TAG_REPORT = "docs.examples.02.tag.report";

class TagExampleProvider {
  static id = "docs.examples.02.tag";

  register(app) {
    app.singleton(FORMATTER_UPPER, () => ({
      id: "upper",
      format(value) {
        return String(value || "").toUpperCase();
      }
    }));

    app.singleton(FORMATTER_LOWER, () => ({
      id: "lower",
      format(value) {
        return String(value || "").toLowerCase();
      }
    }));

    app.tag(FORMATTER_UPPER, FORMATTER_TAG);
    app.tag(FORMATTER_LOWER, FORMATTER_TAG);
  }

  boot(app) {
    app.instance(TAG_REPORT, {
      tagName: FORMATTER_TAG,
      taggedTokens: [FORMATTER_UPPER, FORMATTER_LOWER]
    });
  }
}

export { TagExampleProvider };
