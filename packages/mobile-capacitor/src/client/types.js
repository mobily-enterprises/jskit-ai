// The types of what mobile-capacitor's client hands out and receives across its files.

/** @typedef {import("@jskit-ai/kernel/client/types").ClientRouter} ClientRouter */
/** @typedef {ReturnType<typeof import("@jskit-ai/kernel/client").resolveMobileConfig>} MobileConfig */
/** @typedef {ReturnType<typeof import("./runtime/mobileCapacitorRuntime.js").createMobileCapacitorRuntime>} MobileCapacitorRuntime */
/** @typedef {ReturnType<typeof import("./runtime/mobileLaunchRouting.js").registerMobileLaunchRouting>} MobileLaunchRouting */
/** @typedef {ReturnType<typeof import("./runtime/oauthLaunchClient.js").createCapacitorAwareOAuthLaunchClient>} CapacitorOAuthLaunchClient */

/**
 * What the mobile runtime asks of the native shell. Outside a shell, createNoopCapacitorAppAdapter() has every member.
 * @typedef {object} CapacitorAppAdapter
 * @property {boolean} available Whether a Capacitor shell is there.
 * @property {() => Promise<string>} getInitialLaunchUrl
 * @property {(handler: (url: string) => void) => () => void} subscribeToLaunchUrls
 * @property {(handler: (event: { canGoBack: boolean }) => unknown) => () => void} subscribeToBackButton
 * @property {() => Promise<boolean>} exitApp Whether the shell could leave the application.
 */

/**
 * The handle `addListener` gives back.
 * @typedef {object} CapacitorListenerHandle
 * @property {() => unknown} remove
 */

/**
 * The Capacitor App plugin on the page. The application's shell supplies it, so each function may be missing.
 * @typedef {object} CapacitorAppPlugin
 * @property {() => Promise<{ url?: string } | undefined>} [getLaunchUrl]
 * @property {(eventName: string, handler: (event: Record<string, unknown>) => void) => Promise<CapacitorListenerHandle> | CapacitorListenerHandle} [addListener]
 * @property {() => Promise<void>} [exitApp]
 */

/**
 * The page's location, as far as OAuth launching and launch routing use it.
 * @typedef {object} PageLocation
 * @property {string} origin
 * @property {(url: string) => void} assign
 */

/**
 * The part of `client.shell`'s placement runtime the mobile runtime reads.
 * @typedef {object} MobilePlacementRuntime
 * @property {() => object | null} getContext
 */

/**
 * The part of `client.auth`'s `mobileCallback` the mobile runtime calls.
 * @typedef {object} MobileAuthCallbackCompleter
 * @property {(input: { url: string, fallbackReturnTo: string, placementContext: object | null, defaultProvider: string, refreshSession: () => Promise<unknown> }) => Promise<{ completed: boolean, returnTo?: string }>} completeFromUrl
 */

/**
 * The part of `client.auth`'s `guard` the mobile runtime calls.
 * @typedef {object} MobileAuthGuardRuntime
 * @property {() => Promise<unknown>} initialize
 * @property {() => Promise<unknown>} refresh
 * @property {() => { oauthDefaultProvider?: string }} getState
 */

/**
 * The logger launch routing reports to.
 * @typedef {object} MobileLaunchLogger
 * @property {(details: object, message: string) => void} info
 * @property {(details: object, message: string) => void} warn
 */

/**
 * What `client.mobile` provides.
 * @typedef {object} MobileCapability
 * @property {CapacitorAppAdapter} adapter
 * @property {MobileConfig} config
 * @property {CapacitorOAuthLaunchClient} oauthLaunch
 * @property {() => void} restoreFetch Puts the page's own fetch back; does nothing when it was never replaced.
 */

export {};
