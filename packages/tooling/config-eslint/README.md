# `@jskit-ai/config-eslint`

Shared flat ESLint config presets for monorepo apps and packages.

Exports:

1. `baseConfig`
2. `nodeConfig`
3. `webConfig`
4. `vueConfig`

Usage:

```js
import { baseConfig, nodeConfig, webConfig, vueConfig } from "@jskit-ai/config-eslint";

export default [
  ...baseConfig,
  ...webConfig,
  ...nodeConfig,
  ...vueConfig
];
```

Design boundary:

1. Keep app-specific ignore patterns in each app.
2. Keep app-specific architecture rules in each app.
