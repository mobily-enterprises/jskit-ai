// The types of what uploads-image-web's client hands out and receives across its files.

/** @typedef {ReturnType<typeof import("./composables/createImageUploadRuntime.js").createImageUploadRuntime>} ImageUploadRuntime */
/** @typedef {ReturnType<typeof import("./composables/createManagedImageAssetRuntime.js").createManagedImageAssetRuntime>} ManagedImageAssetRuntime */

/**
 * The Uppy instance behind a runtime, as far as this package and an application's callbacks use it.
 * @typedef {object} ImageUppy
 * @property {(id: string) => any} getPlugin Undefined for a plugin the instance does not hold.
 * @property {() => void} clear
 * @property {() => void} destroy
 */

/**
 * The classes a runtime builds on, replaceable one by one.
 * @typedef {object} ImageUploadDependencies
 * @property {new (options: object) => any} [UppyClass]
 * @property {unknown} [DashboardPlugin]
 * @property {unknown} [ImageEditorPlugin]
 * @property {unknown} [CompressorPlugin]
 * @property {unknown} [XHRUploadPlugin]
 */

/**
 * What the upload-success callback receives.
 * @typedef {object} ImageUploadSuccess
 * @property {Record<string, unknown>} data The server's response body.
 * @property {unknown} file
 * @property {unknown} response
 * @property {ImageUppy} uppy
 */

/**
 * What an application supplies to edit and upload an image.
 * @typedef {object} ImageUploadRuntimeOptions
 * @property {string} [endpoint]
 * @property {string} [method]
 * @property {string} [fieldName]
 * @property {boolean} [withCredentials]
 * @property {number} [maxNumberOfFiles]
 * @property {string[]} [allowedMimeTypes]
 * @property {number} [maxUploadBytes]
 * @property {string} [note] The dashboard's note; empty for the package's own.
 * @property {object} [dashboardOptions]
 * @property {object} [imageEditorOptions]
 * @property {object} [compressorOptions]
 * @property {(xhr: XMLHttpRequest) => unknown} [parseResponse]
 * @property {(request: { xhr: XMLHttpRequest, uppy: ImageUppy }) => Promise<Record<string, unknown>> | Record<string, unknown>} resolveRequestHeaders
 * @property {(fileName: string) => void} [onSelectedFileNameChanged]
 * @property {(success: ImageUploadSuccess) => unknown} onUploadSuccess
 * @property {(failure: { file: unknown, response: unknown, uppy: ImageUppy }) => void} [onInvalidResponse]
 * @property {(failure: { file: unknown, error: Error, response: unknown, uppy: ImageUppy }) => void} onUploadError
 * @property {(failure: { file: unknown, error: Error, uppy: ImageUppy }) => void} onRestrictionFailed
 * @property {() => void} [onUnavailable] Called when the editor is opened outside a browser.
 * @property {ImageUploadDependencies} [dependencies]
 */

/**
 * One message for the application to show.
 * @typedef {object} ImageAssetFeedback
 * @property {string} message
 * @property {string} severity
 * @property {string} channel
 * @property {string} dedupeKey
 */

/**
 * What a delete request receives. An application's own request may ignore `fetch`.
 * @typedef {object} ImageAssetDeleteRequest
 * @property {string} endpoint
 * @property {string} method
 * @property {Record<string, unknown>} headers
 * @property {typeof fetch} fetch
 * @property {string} uploadEndpoint
 * @property {string} deleteEndpoint
 * @property {string} fieldName
 */

/**
 * The classes and functions a managed runtime builds on, replaceable one by one.
 * @typedef {object} ManagedImageAssetDependencies
 * @property {(options: ImageUploadRuntimeOptions) => ImageUploadRuntime} [createImageUploadRuntimeFactory]
 * @property {typeof fetch} [fetchImpl]
 */

/**
 * What an application supplies to manage one image asset: upload, delete and where to show it.
 * @typedef {object} ManagedImageAssetRuntimeOptions
 * @property {import("vue").MaybeRef<string>} [uploadEndpoint] Empty until the asset has a home.
 * @property {import("vue").MaybeRef<string>} [deleteEndpoint] Empty to use the upload endpoint.
 * @property {string} [fieldName]
 * @property {import("vue").MaybeRef<boolean>} [hasAsset]
 * @property {import("vue").MaybeRef<string>} [assetVersion]
 * @property {import("vue").Ref<string>} [selectedFileName] The application's own ref for the chosen file's name.
 * @property {(asset: { uploadEndpoint: string, deleteEndpoint: string, hasAsset: boolean, assetVersion: string, fieldName: string }) => string} [resolveAssetUrl]
 * @property {(request: { action: string, uploadEndpoint: string, deleteEndpoint: string, endpoint: string, fieldName: string }) => Promise<Record<string, unknown>> | Record<string, unknown>} resolveRequestHeaders
 * @property {(success: ImageUploadSuccess) => unknown} onUploadSuccess
 * @property {(success: { data: unknown, response: unknown }) => unknown} [onDeleteSuccess]
 * @property {(failure: { error: Error, response: unknown, fieldName: string, defaultMessage: string }) => string} [resolveUploadErrorMessage]
 * @property {(failure: { error: Error, response: unknown, body: unknown, fieldName: string, defaultMessage: string }) => string} [resolveDeleteErrorMessage]
 * @property {(request: ImageAssetDeleteRequest) => Promise<unknown>} [deleteRequest]
 * @property {(feedback: ImageAssetFeedback) => void} reportFeedback
 * @property {Record<string, string>} [messages] Message keys or plain text, by name.
 * @property {Partial<ImageUploadRuntimeOptions>} [uploadOptions]
 * @property {string} [deleteMethod]
 * @property {string} [source] Names the feature in dedupe keys.
 * @property {ManagedImageAssetDependencies} [dependencies]
 */

export {};
