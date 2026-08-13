export type JskitNavigationSchemaVersion = 1;
export type JskitRouteNavigationBehavior = "destination" | "preserve" | "boundary";
export type JskitNavigationScopeField = "principal" | "surface" | "workspace" | "tenant";
export type JskitNavigationFallbackResolverToken = string;
export type JskitNavigationSanitizerToken = string;

export interface JskitNavigationTarget {
  name?: string;
  path?: string;
  params?: Record<string, string | number>;
  query?: Record<string, string | string[] | null | undefined>;
  hash?: string;
}

export interface JskitRouteNavigationMetaV1 {
  behavior: JskitRouteNavigationBehavior;
  destinationKey?: string;
  machineryKey?: string;
  labelKey?: string;
  fallback?: JskitNavigationTarget | JskitNavigationFallbackResolverToken;
  restore?: readonly string[];
  scope?: readonly JskitNavigationScopeField[];
  persistence?: {
    mode: "none" | "url-only" | "snapshot";
    queryAllowlist?: readonly string[];
    sanitizer?: JskitNavigationSanitizerToken;
  };
}

export interface JskitNavigationScope {
  principal?: string;
  surface?: string;
  workspace?: string;
  tenant?: string;
}

export interface JskitDestinationEntryV1 {
  schema: 1;
  destinationEntryId: string;
  taskId: string;
  destinationKey: string;
  fullPath: string;
  routeName?: string;
  params?: Record<string, string>;
  scope: JskitNavigationScope;
  createdAt: number;
  updatedAt: number;
  snapshotRef?: string;
  fallback?: JskitNavigationTarget;
}

export interface JskitBrowserEntryV1 {
  schema: 1;
  browserEntryId: string;
  taskId: string;
  sequence: number;
  kind: "destination" | "machinery" | "boundary";
  destinationEntryId?: string;
  previousJskitBrowserEntryId?: string;
  fullPath: string;
  routeName?: string;
  machineryKey?: string;
  createdAt: number;
}

export interface JskitScrollSnapshotV1 {
  x: number;
  y: number;
  anchor?: {
    contributorId: string;
    itemKey: string;
    block?: "start" | "center" | "end" | "nearest";
    offsetX?: number;
    offsetY?: number;
  };
}

export interface JskitFocusSnapshotV1 {
  contributorId?: string;
  focusKey?: string;
  selector?: string;
}

export interface JskitDestinationSnapshotV1 {
  schema: 1;
  destinationEntryId: string;
  route: {
    fullPath: string;
    path: string;
    query: Record<string, string | string[]>;
    hash: string;
  };
  scroll?: JskitScrollSnapshotV1;
  focus?: JskitFocusSnapshotV1;
  contributors: Record<string, { version: number; value: unknown }>;
  capturedAt: number;
}

export interface JskitHistoryNavigationEnvelopeV1 {
  schema: 1;
  taskId: string;
  browserEntryId: string;
  destinationEntryId?: string;
  previousJskitBrowserEntryId?: string;
  sequence: number;
  kind: "destination" | "machinery" | "boundary";
  destinationKey?: string;
  machineryKey?: string;
  snapshotRef?: string;
}

export interface JskitNavigationTaskV1 {
  schema: 1;
  taskId: string;
  browserEntries: Record<string, { entry: JskitBrowserEntryV1; lastSeenAt: number }>;
  destinations: Record<string, { entry: JskitDestinationEntryV1; lastSeenAt: number }>;
  activeBrowserEntryId: string;
}

export interface JskitNavigationLimits {
  maxEntries: number;
  maxSnapshotBytes: number;
  maxTaskBytes: number;
  maxObjectDepth: number;
  maxObjectKeys: number;
  ttlMs: number;
  contributorRegistrationTimeoutMs: number;
  dataReadyTimeoutMs: number;
  focusTimeoutMs: number;
}

export interface JskitNavigationResolverContext {
  route: Readonly<{
    name?: string;
    fullPath: string;
    path: string;
    query: Record<string, unknown>;
    hash: string;
  }>;
  scope: Readonly<JskitNavigationScope>;
  signal: AbortSignal;
}

export type JskitNavigationFallbackResolver = (
  context: JskitNavigationResolverContext
) => JskitNavigationTarget | null | Promise<JskitNavigationTarget | null>;

export type JskitNavigationSanitizer = (
  context: JskitNavigationResolverContext
) => Readonly<{ path: string; query: Record<string, string | string[]>; hash: string }> | null;

export interface JskitNavigationResolverRegistry {
  registerFallback(token: string, resolver: JskitNavigationFallbackResolver): () => void;
  registerSanitizer(token: string, sanitizer: JskitNavigationSanitizer): () => void;
  resolveFallback(token: string): JskitNavigationFallbackResolver | undefined;
  resolveSanitizer(token: string): JskitNavigationSanitizer | undefined;
}

export const JSKIT_NAVIGATION_SCHEMA_VERSION: 1;
export const JSKIT_ROUTE_NAVIGATION_BEHAVIORS: readonly JskitRouteNavigationBehavior[];
export const JSKIT_NAVIGATION_SCOPE_FIELDS: readonly JskitNavigationScopeField[];
export const DEFAULT_JSKIT_NAVIGATION_LIMITS: Readonly<JskitNavigationLimits>;
export const HARD_JSKIT_NAVIGATION_LIMITS: Readonly<JskitNavigationLimits>;

export function createJskitNavigationLimits(overrides?: Partial<JskitNavigationLimits>): Readonly<JskitNavigationLimits>;
export function normalizeJskitNavigationTarget(target: string | JskitNavigationTarget): Readonly<JskitNavigationTarget>;
export function validateJskitRouteNavigationMeta(meta: JskitRouteNavigationMetaV1): Readonly<JskitRouteNavigationMetaV1>;
export function resolveJskitRouteNavigationMeta(
  route: { matched?: readonly unknown[]; name?: unknown; path?: string; fullPath?: string }
): Readonly<JskitRouteNavigationMetaV1> | null;
export function normalizeJskitInternalFullPath(value: string, options?: { base?: string }): string;
export function isSafeJskitInternalFullPath(value: string, options?: { base?: string }): boolean;
export function normalizeJskitNavigationScope(value?: JskitNavigationScope): Readonly<JskitNavigationScope>;
export function jskitNavigationScopesMatch(
  stored: JskitNavigationScope,
  current: JskitNavigationScope,
  requiredFields?: readonly JskitNavigationScopeField[]
): boolean;
export function normalizeJskitSerializableValue<T>(
  value: T,
  options?: { limits?: Partial<JskitNavigationLimits>; maxBytes?: number }
): T;
export function createJskitNavigationResolverRegistry(): JskitNavigationResolverRegistry;
export function readJskitHistoryNavigationEnvelope(state: unknown): Readonly<JskitHistoryNavigationEnvelopeV1> | null;
export function mergeJskitHistoryNavigationEnvelope(
  state: unknown,
  envelope: JskitHistoryNavigationEnvelopeV1
): Record<string, unknown>;
export function createEmptyJskitNavigationTask(taskId: string): Readonly<JskitNavigationTaskV1>;
export function reduceJskitNavigationTask(
  task: JskitNavigationTaskV1,
  event:
    | { type: "commit"; browserEntry: JskitBrowserEntryV1; destinationEntry?: JskitDestinationEntryV1; now?: number }
    | { type: "write-destination"; destinationEntry: JskitDestinationEntryV1; now?: number }
    | { type: "activate"; browserEntryId: string; now?: number }
    | { type: "remove-destination"; destinationEntryId: string; now?: number }
): Readonly<JskitNavigationTaskV1>;
export function projectJskitNavigationTask(task: JskitNavigationTaskV1): Readonly<{
  browserTrail: readonly JskitBrowserEntryV1[];
  destinationTrail: readonly JskitDestinationEntryV1[];
  canPop: boolean;
}>;
