const OPTIONAL_AUDIT_SINK = "docs.examples.02.optional.auditSink";
const HAS_REPORT = "docs.examples.02.has.report";

class HasExampleProvider {
  static id = "docs.examples.02.has";

  register() {}

  boot(app) {
    const hasOptionalAuditSink = app.has(OPTIONAL_AUDIT_SINK);

    if (hasOptionalAuditSink) {
      const sink = app.make(OPTIONAL_AUDIT_SINK);
      if (sink && typeof sink.record === "function") {
        sink.record({ event: "has-example-provider.boot" });
      }
    }

    app.instance(HAS_REPORT, {
      hasOptionalAuditSink,
      usedFallbackPath: !hasOptionalAuditSink
    });
  }
}

export { HasExampleProvider };
