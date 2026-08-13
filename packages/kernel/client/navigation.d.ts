import type { ComputedRef, InjectionKey } from "vue";
import type { RouteLocationNormalizedLoaded, Router, RouterHistory, RouterScrollBehavior } from "vue-router";
import type {
  JskitBrowserEntryV1,
  JskitDestinationEntryV1,
  JskitDestinationSnapshotV1,
  JskitNavigationFallbackResolverToken,
  JskitNavigationLimits,
  JskitNavigationResolverRegistry,
  JskitNavigationSanitizerToken,
  JskitNavigationScope,
  JskitNavigationTaskV1,
  JskitNavigationTarget
} from "../shared/navigation.js";

export type {
  JskitBrowserEntryV1,
  JskitDestinationEntryV1,
  JskitDestinationSnapshotV1,
  JskitNavigationFallbackResolverToken,
  JskitNavigationLimits,
  JskitNavigationResolverRegistry,
  JskitNavigationSanitizerToken,
  JskitNavigationScope,
  JskitNavigationTaskV1,
  JskitNavigationTarget
} from "../shared/navigation.js";

export type JskitNavigationReason =
  | "link"
  | "primary-navigation"
  | "programmatic"
  | "shell-back"
  | "system-back"
  | "browser-pop"
  | "redirect"
  | "save-complete";

export interface PushOptions {
  reason?: JskitNavigationReason;
  focus?: "auto" | "heading" | "preserve";
}

export interface PreserveOptions extends PushOptions {
  replaceCurrentBrowserEntry?: boolean;
}

export interface ReplaceOptions extends PushOptions {
  preserveDestinationIdentity?: boolean;
}

export interface PopOptions {
  reason?: Extract<JskitNavigationReason, "shell-back" | "system-back" | "programmatic" | "save-complete">;
}

export interface NavigationResult {
  status: "completed" | "cancelled" | "blocked" | "degraded";
  reason?: string;
  browserEntryId?: string;
  destinationEntryId?: string;
}

export interface CaptureResult {
  status: "captured" | "skipped" | "degraded";
  destinationEntryId?: string;
  snapshotRef?: string;
  reason?: string;
}

export interface RestoreContext {
  transactionId: string;
  reason: "pop" | "forward" | "reload" | "bfcache" | "synthetic-fallback";
  route: Readonly<{ fullPath: string; path: string; query: Record<string, unknown>; hash: string }>;
  browserEntryId: string;
  destinationEntryId: string;
  scope: Readonly<Record<"principal" | "surface" | "workspace" | "tenant", string | undefined>>;
  signal: AbortSignal;
}

export interface RestoreResult {
  status: "restored" | "skipped" | "degraded";
  reason?: string;
}

export interface JskitScrollTarget {
  itemKey?: string;
  offsetX?: number;
  offsetY?: number;
  scroll(
    target: Readonly<{ itemKey?: string; offsetX?: number; offsetY?: number }>,
    context: RestoreContext
  ): void | Promise<void>;
}

export interface JskitFocusTarget {
  focusKey: string;
  focus(context: RestoreContext): boolean | Promise<boolean>;
}

export interface JskitNavigationContributor<T> {
  id: string;
  version: number;
  capture(): T | undefined | Promise<T | undefined>;
  restoreBeforeData?(value: T, context: RestoreContext): void | RestoreResult | Promise<void | RestoreResult>;
  isDataReady?(context: RestoreContext): boolean | Promise<boolean>;
  restoreStructure?(value: T, context: RestoreContext): void | RestoreResult | Promise<void | RestoreResult>;
  resolveScrollTarget?(value: T, context: RestoreContext): JskitScrollTarget | undefined | Promise<JskitScrollTarget | undefined>;
  resolveFocusTarget?(value: T, context: RestoreContext): JskitFocusTarget | undefined | Promise<JskitFocusTarget | undefined>;
  migrate?(value: unknown, fromVersion: number): T | undefined;
  sanitize?(value: T): T | undefined;
}

export interface JskitTransientLayer {
  id: string;
  isOpen(): boolean;
  close(reason: "back" | "up" | "navigation"): boolean | Promise<boolean>;
  priority?: number;
}

export interface JskitNavigationBlocker {
  id: string;
  isBlocked(context: {
    to: RouteLocationNormalizedLoaded;
    from: RouteLocationNormalizedLoaded;
  }): boolean | Promise<boolean>;
  title?: string;
  message?: string;
}

export interface JskitNavigationStorage {
  readonly available: boolean;
  readTask(taskId: string): Promise<JskitNavigationTaskV1 | null>;
  writeTask(task: JskitNavigationTaskV1): Promise<void>;
  readBrowserEntry(taskId: string, browserEntryId: string): Promise<JskitBrowserEntryV1 | null>;
  writeBrowserEntry(entry: JskitBrowserEntryV1): Promise<void>;
  readDestination(taskId: string, destinationEntryId: string): Promise<JskitDestinationEntryV1 | null>;
  writeDestination(entry: JskitDestinationEntryV1): Promise<void>;
  readSnapshot(taskId: string, snapshotRef: string): Promise<JskitDestinationSnapshotV1 | null>;
  writeSnapshot(taskId: string, snapshot: JskitDestinationSnapshotV1): Promise<string>;
  deleteTask(taskId: string): Promise<void>;
  prune(now: number, limits: JskitNavigationLimits): Promise<void>;
}

export interface JskitNavigationScrollCoordinator {
  readonly scrollBehavior: RouterScrollBehavior;
  attach(navigation: JskitNavigationRuntime): void;
  dispose(): void;
}

export interface JskitNavigationRuntime {
  readonly state: Readonly<{
    ready: boolean;
    canPop: boolean;
    canGoUp: boolean;
    activeEntry: JskitDestinationEntryV1 | null;
    previousEntry: JskitDestinationEntryV1 | null;
    restoring: boolean;
    predictiveProgress: number | null;
  }>;
  readonly blockerState: Readonly<{
    pending: boolean;
    blockerId: string;
    title: string;
    message: string;
  }>;
  readonly taskId: string;
  initialize(): Promise<JskitNavigationRuntime>;
  push(target: string | JskitNavigationTarget, options?: PushOptions): Promise<NavigationResult>;
  preserve(target: string | JskitNavigationTarget, options?: PreserveOptions): Promise<NavigationResult>;
  replace(target: string | JskitNavigationTarget, options?: ReplaceOptions): Promise<NavigationResult>;
  pop(options?: PopOptions): Promise<NavigationResult>;
  goUp(options?: PopOptions): Promise<NavigationResult>;
  capture(destinationEntryId?: string): Promise<CaptureResult>;
  notifyAppMounted(): void;
  peekContributorSnapshot<T = unknown>(contributorId: string): Readonly<{ version: number; value: T }> | undefined;
  registerContributor<T>(contributor: JskitNavigationContributor<T>): () => void;
  registerTransientLayer(layer: JskitTransientLayer): () => void;
  registerBlocker(blocker: JskitNavigationBlocker): () => void;
  setScope(scope: Partial<JskitNavigationScope>): Promise<NavigationResult>;
  confirmBlockedNavigation(): boolean;
  cancelBlockedNavigation(): boolean;
  restoreBlockedNavigationFocus(): boolean;
  setPredictiveProgress(progress: number | null): void;
  shouldDeferScroll(route: RouteLocationNormalizedLoaded | string): boolean;
  dispose(): void;
}

export interface InstallJskitNavigationOptions {
  router: Router;
  history: RouterHistory;
  storage?: JskitNavigationStorage | null;
  scopeResolver?(context: { route: RouteLocationNormalizedLoaded; signal: AbortSignal }): JskitNavigationScope | Promise<JskitNavigationScope>;
  resolvers?: JskitNavigationResolverRegistry;
  limits?: Partial<JskitNavigationLimits>;
  scrollCoordinator?: JskitNavigationScrollCoordinator;
  logger?: Pick<Console, "info" | "warn" | "error" | "debug">;
  windowObject?: Window | null;
  documentObject?: Document | null;
  cryptoObject?: Crypto;
  now?: () => number;
  development?: boolean;
}

export const JSKIT_NAVIGATION_RUNTIME_KEY: InjectionKey<JskitNavigationRuntime>;

export function createBrowserSessionNavigationStorage(options?: {
  storage?: Storage | null;
  limits?: Partial<JskitNavigationLimits>;
  now?: () => number;
  cryptoObject?: Crypto;
  logger?: Pick<Console, "warn">;
}): JskitNavigationStorage;

export function createJskitNavigationScrollCoordinator(options?: {
  fallback?: RouterScrollBehavior;
}): JskitNavigationScrollCoordinator;

export function installJskitNavigation(options: InstallJskitNavigationOptions): JskitNavigationRuntime;

export function useJskitNavigation(): Readonly<{
  canPop: ComputedRef<boolean>;
  canGoUp: ComputedRef<boolean>;
  activeEntry: ComputedRef<JskitDestinationEntryV1 | null>;
  previousEntry: ComputedRef<JskitDestinationEntryV1 | null>;
  restoring: ComputedRef<boolean>;
  predictiveProgress: ComputedRef<number | null>;
  push: JskitNavigationRuntime["push"];
  preserve: JskitNavigationRuntime["preserve"];
  replace: JskitNavigationRuntime["replace"];
  pop: JskitNavigationRuntime["pop"];
  goUp: JskitNavigationRuntime["goUp"];
  capture: JskitNavigationRuntime["capture"];
  peekContributorSnapshot: JskitNavigationRuntime["peekContributorSnapshot"];
  registerContributor: JskitNavigationRuntime["registerContributor"];
  registerTransientLayer: JskitNavigationRuntime["registerTransientLayer"];
}>;

export function useJskitNavigationBlocker(options: JskitNavigationBlocker): Readonly<{
  pending: ComputedRef<boolean>;
  unregister(): void;
}>;
