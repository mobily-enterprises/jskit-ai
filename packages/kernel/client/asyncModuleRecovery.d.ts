export type AsyncModuleRecoveryState = {
  attempt: number;
  error: any;
  label: string;
  message: string;
  retry: (() => any) | null;
  stale: boolean;
  visible: boolean;
};

export function createAsyncModuleRecoveryState(options?: {
  label?: string;
  message?: string;
  retry?: (() => any) | null;
}): AsyncModuleRecoveryState;

export function isDynamicImportError(error?: any): boolean;

export function dynamicImportErrorMessage(error?: any, options?: {
  label?: string;
  stale?: boolean;
}): string;

export function notifyAsyncModuleLoadError(
  state: AsyncModuleRecoveryState,
  error?: any,
  options?: {
    label?: string;
    message?: string;
    retry?: (() => any) | null;
    stale?: boolean;
  }
): AsyncModuleRecoveryState;

export function dismissAsyncModuleRecovery(state: AsyncModuleRecoveryState): boolean;

export function guardedReloadApp(options?: {
  browserWindow?: any;
  fetchFn?: ((input: string, init?: Record<string, any>) => Promise<any>) | null;
  state?: AsyncModuleRecoveryState | null;
  label?: string;
  message?: string;
}): Promise<boolean>;

export function installAsyncModuleRecoveryHandlers(options?: {
  router?: any;
  state: AsyncModuleRecoveryState;
  label?: string;
  onNotify?: (state: AsyncModuleRecoveryState) => void;
  windowObject?: any;
}): Readonly<{
  dispose: () => void;
}>;
