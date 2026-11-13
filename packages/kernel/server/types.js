// The types of the capabilities the kernel provides and the installed runtime
// seeds, for features that require them.

/** @typedef {ReturnType<typeof import("./actions/actionCatalogue.js").createActionCatalogue>} ActionCatalogue */
/** @typedef {ReturnType<typeof import("./actions/actionDefinitions.js").normalizeActionDefinition>} ActionDefinition An action as the catalogue holds it, normalized from its feature's definition. */
/** @typedef {ReturnType<typeof import("./runtime/bootstrapRuntime.js").createBootstrapRuntime>} RuntimeBootstrap */
/** @typedef {ReturnType<typeof import("./runtime/eventRuntime.js").createEventRuntime>} RuntimeEvents */
/** @typedef {ReturnType<typeof import("./http/capabilityHttpRuntime.js").createCapabilityHttpRuntime>} RuntimeHttp */
/** @typedef {ReturnType<typeof import("./runtime/healthRuntime.js").createHealthRuntime>} RuntimeHealth The health checks providers register and the application's health route runs. */
/** @typedef {ReturnType<typeof import("./http/lib/router.js").createRouter>} RuntimeRouter The router of `runtime.http`, on which features register their routes. */

/** @typedef {string} RuntimeAppRoot The application's root directory. */
/** @typedef {Readonly<Record<string, any>>} RuntimeConfig The application's configuration. */
/** @typedef {Readonly<Record<string, string | undefined>>} RuntimeEnv The process environment the application started with. */
/** @typedef {import("fastify").FastifyInstance} RuntimeFastify */

/**
 * The application's logger (debug, info, warn, error).
 * @typedef {object} RuntimeLogger
 * @property {(...args: any[]) => void} debug
 * @property {(...args: any[]) => void} info
 * @property {(...args: any[]) => void} warn
 * @property {(...args: any[]) => void} error
 */

/**
 * What the capability runtime passes a provider's setup().
 * @typedef {object} ProviderSetupContext
 * @property {string} profile
 */

/**
 * What the capability runtime passes a provider's boot() and shutdown().
 * @typedef {object} ProviderLifecycleContext
 * @property {Readonly<Record<string, any>>} outputs The capabilities this provider's setup() returned, by local name.
 * @property {string} profile
 */

/**
 * A capability provider. Its lifecycle hooks receive the capabilities it
 * requires and the optional ones that are installed, by local name.
 * @typedef {object} ProviderDefinition
 * @property {string} id
 * @property {Record<string, string>} [requires]
 * @property {Record<string, string>} [optional]
 * @property {Record<string, string>} [provides]
 * @property {Record<string, string>} [hints] What to register when a required capability is missing, keyed by its id;
 *   the startup error adds it.
 * @property {(dependencies: any, context: ProviderSetupContext) => any} setup Returns the provided capabilities, by local name.
 * @property {((dependencies: any, context: ProviderLifecycleContext) => any) | null} [boot]
 * @property {((dependencies: any, context: ProviderLifecycleContext) => any) | null} [shutdown]
 */

/**
 * Where a package's manifest (`jskit.capabilities`) and its server providers disagree. Each list is sorted.
 * @typedef {object} ManifestCapabilityDrift
 * @property {ReadonlyArray<string>} manifestProvides What the manifest provides, client capabilities aside.
 * @property {ReadonlyArray<string>} provided What the providers provide.
 * @property {ReadonlyArray<string>} unlistedProvides Provided by a provider, not by the manifest.
 * @property {ReadonlyArray<string>} extraProvides Provided by the manifest, by no provider.
 * @property {ReadonlyArray<string>} unlistedRequires Required by a provider, not by the manifest, and neither the kernel's
 *   own nor provided by the package.
 * @property {ReadonlyArray<string>} extraRequires Required by the manifest, by no provider: an install-time requirement,
 *   or a stale one.
 */

/**
 * What a feature's setup() and actions() receive besides their dependencies.
 * @typedef {object} FeatureSetupContext
 * @property {string} profile
 * @property {ActionCatalogue} actionCatalogue Only for a feature that declares actions; a feature that declares none
 *   does not require `runtime.actions`, and reading this names the fix.
 */

/**
 * A feature: a provider that can also register actions. Its hooks receive the
 * capabilities it requires and the optional ones that are installed, by local
 * name; actions() also receives the capabilities setup() returned.
 * @typedef {object} FeatureDefinition
 * @property {string} id
 * @property {string} [domain]
 * @property {Record<string, string>} [requires]
 * @property {Record<string, string>} [optional]
 * @property {Record<string, string>} [provides]
 * @property {Record<string, string>} [hints] What to register when a required capability is missing, keyed by its id.
 * @property {(dependencies: any, context: FeatureSetupContext) => any} [setup] Returns the provided capabilities, by local name.
 * @property {ReadonlyArray<object> | ((dependencies: any, context: FeatureSetupContext) => ReadonlyArray<object> | Promise<ReadonlyArray<object>>)} [actions]
 * @property {Record<string, any>} [actionDefaults]
 * @property {((dependencies: any, context: ProviderLifecycleContext) => any) | null} [boot]
 * @property {((dependencies: any, context: ProviderLifecycleContext) => any) | null} [shutdown]
 * @property {ReadonlyArray<object>} [owns] The table resources this feature owns, each a table resource or `{ resource, ...serverOnlyExtras }`. Its setup() receives their handles as `resources`, by resource name, and it is the only feature that does. An entry's `rowPolicy` receives the capabilities the feature requires (and its optional ones), by local name, as `requires`.
 * @property {string} [systemScope] Why this feature works across every workspace and user, such as a background job. Its setup() receives `systemContext(reason)`.
 */

/**
 * The `runtime.resources` capability, as the kernel uses it for a feature's
 * `owns` and `systemScope`. The kernel knows nothing else about resources.
 * @typedef {object} ResourceRuntime
 * @property {(featureId: string, owns: ReadonlyArray<object>, options?: { requires?: Readonly<Record<string, any>> }) => Record<string, object> | Promise<Record<string, object>>} own Registers the feature as the one owner of each resource and returns their handles, by resource name. Throws when another feature owns one of their tables. `requires`, the feature's resolved dependencies, reaches each entry's row policy.
 * @property {(featureId: string, systemScope: string) => (reason: string) => object} declareSystemScope Records the feature's system scope and returns its system context factory: each call, given its reason, answers a context that reads and writes every workspace's and user's rows.
 */

/**
 * An application's rule for every action it registers, supplied once as the
 * optional `runtime.actions.policy` capability. Actions declare the data the
 * rule reads in their `extensions`; the policy turns it into behaviour, so no
 * definition is wrapped by a helper. Without a policy, each action is
 * registered with the input it declares and runs its own `execute`.
 * @typedef {object} ActionPolicy
 * @property {(definition: ActionDefinition) => ActionDefinition["input"]} input Called once per action, at registration, with the action as declared: returns the input schema the action is validated and listed with.
 * @property {(execution: ActionPolicyExecution) => unknown} execute Called for every execution, after the channel, surface, permission and input checks: runs the action through `execution.run`, with the input and context it should receive, inside any scope it needs.
 */

/**
 * One execution, as the action policy receives it.
 * @typedef {object} ActionPolicyExecution
 * @property {ActionDefinition} definition The action as its feature declared it, before the policy's input.
 * @property {Record<string, any>} input The input, validated against the policy's input schema.
 * @property {Record<string, any>} context The execution context.
 * @property {(input: Record<string, any>, context: Record<string, any>) => unknown} run Calls the action's own execute with this input and context, and returns its result.
 */

export {};
