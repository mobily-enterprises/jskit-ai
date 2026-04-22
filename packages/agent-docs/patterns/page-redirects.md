# Page Redirect Patterns

Use when:

- redirecting a page index route to a child page
- writing `definePage({ redirect: ... })`
- seeding settings landing pages such as `/home/settings`
- wiring a section shell that should land on a real child page first

Check first:

- whether the page is only a landing route for child pages
- whether the destination child route is explicit and stable
- whether the redirect should preserve incoming query and hash

Rules:

- For “index page lands on child page” redirects, use `redirectToChild()` from `@jskit-ai/kernel/client/pageRedirects`.
- Do not hand-build child redirects with string surgery such as `` `${String(to.path || "").replace(/\\/$/, "")}/general` ``.
- Keep the destination explicit. Do not infer it from placements, menu order, or “first child page wins” behavior.
- If the redirect is just “go to this child page”, prefer:

```js
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";

definePage({
  redirect: redirectToChild("general")
});
```

Why:

- the helper centralizes slash handling
- it preserves incoming query and hash unless the child target overrides them
- templates, guides, and apps all stay on one obvious pattern

Avoid:

- copying redirect lambdas between apps and templates
- building implicit redirect behavior from placements
- inventing page-local helper utilities for the same pattern
