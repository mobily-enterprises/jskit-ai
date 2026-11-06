// The values http-web's client hands out and receives across files, for its own modules and for the packages and
// applications that read records through it.

/**
 * The client every request goes through: `getHttpWebClient()`, or one an application supplies.
 * @typedef {object} HttpClient
 * @property {(url: string, options?: Record<string, any>) => Promise<any>} request
 */

/**
 * A CRUD resource definition, as `@jskit-ai/resource-crud-core` declares it.
 * @typedef {object} CrudResource
 * @property {string} [namespace]
 * @property {string} [apiAccess] `"authenticated"` by default; `"public"` sends no CSRF token.
 * @property {Record<string, any>} [operations]
 * @property {Record<string, any>} [contract]
 * @property {Record<string, string>} [messages]
 */

/** @typedef {import("vue").MaybeRefOrGetter<string>} TextSource */
/** @typedef {import("vue").MaybeRefOrGetter<boolean | undefined>} EnabledSource */
/** @typedef {string | ((context: Record<string, any>) => string) | import("vue").Ref<string>} ApiSuffix */
/** @typedef {boolean | import("vue").Ref<boolean> | ((context: Record<string, any>) => boolean)} ReadEnabled */
/** @typedef {(surfaceId: string, scopeParamValue?: string, ownershipFilter?: string) => unknown[]} QueryKeyFactory */
/** @typedef {false | string | { enabled?: boolean, label?: string, source?: string, dedupeKey?: string, method?: string, dedupeWindowMs?: number } | null} RequestRecovery */
/** @typedef {Record<string, any> | import("vue").Ref<Record<string, any>> | ((context: Record<string, any>) => Record<string, any>) | null} RequestQueryParams */
/** @typedef {(model: any, payload: any, context: Record<string, any>) => void} MapLoadedToModel */

/**
 * What an operation's `realtime` option declares, or `false` to refuse a resource's own.
 * @typedef {object} OperationRealtime
 * @property {string} [event]
 * @property {string[]} [events]
 * @property {(context: import("@jskit-ai/realtime/client/types").RealtimeEventContext) => boolean} [matches]
 * @property {(context: import("@jskit-ai/realtime/client/types").RealtimeEventContext) => unknown} [onEvent] Runs before the matching queries refresh.
 * @property {unknown} [queryKey] Replaces the key the operation reads.
 * @property {EnabledSource} [enabled]
 */

/**
 * What `useRealtimeQueryInvalidation()` listens for.
 * @typedef {object} RealtimeQueryInvalidationOptions
 * @property {import("vue").MaybeRef<string>} [event]
 * @property {EnabledSource} [enabled]
 * @property {(context: import("@jskit-ai/realtime/client/types").RealtimeEventContext) => boolean} [matches]
 * @property {import("vue").MaybeRefOrGetter<unknown[] | null>} [queryKey] One key, or a list of keys.
 * @property {(context: import("@jskit-ai/realtime/client/types").RealtimeEventContext) => unknown} [onEvent]
 */

/**
 * @typedef {object} OperationRealtimeOptions
 * @property {OperationRealtime | false | null} [realtime]
 * @property {import("vue").MaybeRefOrGetter<unknown[] | null>} [queryKey]
 * @property {EnabledSource} [enabled]
 */

/**
 * @typedef {object} EndpointResourceOptions
 * @property {import("vue").MaybeRefOrGetter<unknown[]>} [queryKey] A write-only resource has none.
 * @property {import("vue").MaybeRef<string>} [path]
 * @property {EnabledSource} [enabled]
 * @property {HttpClient} [client]
 * @property {string} [readMethod]
 * @property {string} [writeMethod]
 * @property {import("vue").MaybeRef<Record<string, any> | null>} [readQuery]
 * @property {Record<string, any> | null} [transport]
 * @property {boolean} [refreshOnPull]
 * @property {OperationRealtime | false | null} [realtime]
 * @property {Record<string, any> | null} [queryOptions]
 * @property {Record<string, any> | null} [mutationOptions]
 * @property {RequestRecovery} [requestRecovery]
 * @property {string} [requestRecoveryLabel]
 * @property {string} [fallbackLoadError]
 * @property {string} [fallbackSaveError]
 */

/** @typedef {ReturnType<typeof import("./composables/runtime/useEndpointResource.js").useEndpointResource>} EndpointResource */

/**
 * @typedef {object} PagedCollectionOptions
 * @property {import("vue").MaybeRef<unknown[]>} queryKey
 * @property {EnabledSource} [enabled]
 * @property {unknown} [initialPageParam]
 * @property {(context: { pageParam: unknown, signal: AbortSignal }) => Promise<any>} queryFn
 * @property {(lastPage: any, allPages: any[], lastPageParam: unknown, allPageParams: unknown[]) => unknown} [getNextPageParam]
 * @property {(page: any) => any[]} [selectItems]
 * @property {(item: any) => unknown} [dedupeBy] Keeps the first item of each key; without it every item stays.
 * @property {Record<string, any> | null} [queryOptions]
 * @property {string} [fallbackLoadError]
 */

/** @typedef {ReturnType<typeof import("./composables/usePagedCollection.js").usePagedCollection>} PagedCollection */

/**
 * @typedef {object} ListCoreOptions
 * @property {import("vue").MaybeRef<unknown[]>} queryKey
 * @property {import("vue").MaybeRef<string>} [path]
 * @property {EnabledSource} [enabled]
 * @property {HttpClient} [client]
 * @property {Record<string, any> | null} [transport]
 * @property {unknown} [initialPageParam]
 * @property {PagedCollectionOptions["getNextPageParam"]} [getNextPageParam]
 * @property {PagedCollectionOptions["selectItems"]} [selectItems]
 * @property {import("vue").MaybeRef<Record<string, any> | null>} [requestOptions]
 * @property {Record<string, any> | null} [queryOptions]
 * @property {RequestRecovery} [requestRecovery]
 * @property {string} [requestRecoveryLabel]
 * @property {string} [fallbackLoadError]
 */

/**
 * @typedef {object} UiFeedbackOptions
 * @property {string} [initialType]
 * @property {string} [source]
 * @property {string} [successChannel]
 * @property {string} [errorChannel]
 * @property {number} [dedupeWindowMs]
 */

/** @typedef {ReturnType<typeof import("./composables/runtime/useUiFeedback.js").useUiFeedback>} UiFeedback */
/** @typedef {ReturnType<typeof import("./composables/runtime/useFieldErrorBag.js").useFieldErrorBag>} FieldErrorBag */

/**
 * @typedef {object} OperationErrorReporting
 * @property {boolean} [enabled]
 * @property {string} [source]
 * @property {import("vue").Ref<string> | null} [loadError]
 * @property {import("vue").Ref<string> | null} [notFoundError]
 * @property {(context: { message: string, kind: string }) => Record<string, any> | null} [loadActionFactory]
 * @property {(context: { message: string, kind: string }) => Record<string, any> | null} [notFoundActionFactory]
 * @property {string} [loadChannel]
 * @property {string} [notFoundChannel]
 * @property {string} [loadSeverity]
 * @property {string} [notFoundSeverity]
 * @property {number} [dedupeWindowMs]
 */

/**
 * A check of an operation's input. Left out, `fieldBag` and `feedback` stay silent.
 * @typedef {object} OperationInputCheck
 * @property {unknown} [input]
 * @property {Record<string, any>} [rawPayload]
 * @property {Pick<FieldErrorBag, "apply">} [fieldBag]
 * @property {Pick<UiFeedback, "error">} [feedback]
 * @property {string} [validationMessage]
 */

/**
 * @typedef {object} ScopeRuntimeOptions
 * @property {string} [ownershipFilter]
 * @property {string} [surfaceId]
 * @property {string} [accessMode]
 * @property {boolean} [hasPermissionRequirements]
 */

/** @typedef {ReturnType<typeof import("./composables/useScopeRuntime.js").useScopeRuntime>} ScopeRuntime */

/**
 * @typedef {object} AccessOptions
 * @property {EnabledSource} [enabled]
 * @property {string} [access]
 * @property {boolean} [hasPermissionRequirements]
 */

/** @typedef {ReturnType<typeof import("./composables/useAccess.js").useAccess>} AccessRuntime */

/**
 * @typedef {object} OperationScopeOptions
 * @property {string} [ownershipFilter]
 * @property {string} [surfaceId]
 * @property {string} [access]
 * @property {ApiSuffix} [apiSuffix]
 * @property {object} [model]
 * @property {ReadEnabled} [readEnabled]
 * @property {QueryKeyFactory} [queryKeyFactory] A command reads nothing and has none.
 * @property {Record<string, string | string[]>} [permissionSets]
 * @property {OperationRealtime | false | null} [realtime]
 */

/** @typedef {ReturnType<typeof import("./composables/internal/useOperationScope.js").useOperationScope>} OperationScope */

/**
 * @typedef {object} AddEditCoreOptions
 * @property {object} [model]
 * @property {EndpointResource} resource
 * @property {import("vue").Ref<unknown>} queryKey
 * @property {import("vue").Ref<boolean>} canSave
 * @property {FieldErrorBag} fieldBag
 * @property {UiFeedback} feedback
 * @property {unknown} [input]
 * @property {MapLoadedToModel} [mapLoadedToModel]
 * @property {(model: any, context: Record<string, any>) => Record<string, any>} [buildRawPayload]
 * @property {(parsedInput: any, context: Record<string, any>) => unknown} [buildSavePayload]
 * @property {(payload: any, context: Record<string, any>) => unknown} [onSaveSuccess]
 * @property {boolean} [validationFeedback]
 * @property {Record<string, string>} [messages]
 */

/**
 * @typedef {object} CommandCoreOptions
 * @property {object} [model]
 * @property {EndpointResource} resource
 * @property {string} [writeMethod]
 * @property {import("vue").Ref<boolean>} canRun
 * @property {FieldErrorBag} fieldBag
 * @property {UiFeedback} feedback
 * @property {unknown} [input]
 * @property {(model: any, context: Record<string, any>) => Record<string, any>} [buildRawPayload]
 * @property {(parsedInput: any, context: Record<string, any>) => unknown} [buildCommandPayload] Without it a command sends its parsed input, and nothing for DELETE.
 * @property {(parsedInput: any, context: Record<string, any>) => Record<string, any>} [buildCommandOptions]
 * @property {(response: any, context: Record<string, any>) => unknown} [onRunSuccess]
 * @property {(error: unknown, context: Record<string, any>) => unknown} [onRunError]
 * @property {boolean} [suppressSuccessMessage]
 * @property {Record<string, string>} [messages]
 */

/**
 * @typedef {object} ViewCoreOptions
 * @property {EndpointResource} resource
 * @property {object} [model]
 * @property {import("vue").Ref<boolean>} [canView]
 * @property {MapLoadedToModel} [mapLoadedToModel]
 * @property {number[]} [notFoundStatuses]
 * @property {string} [notFoundMessage]
 */

/**
 * @typedef {object} RouteTemplateOptions
 * @property {string} [recordIdParam]
 * @property {import("vue").MaybeRefOrGetter<Record<string, unknown>> | null} [routeParams]
 * @property {import("vue").MaybeRefOrGetter<string[]> | null} [routeParamNames]
 * @property {import("vue").MaybeRefOrGetter<string>} [routePath]
 */

/**
 * @typedef {RouteTemplateOptions & {
 *   routeRecordId?: import("vue").MaybeRefOrGetter<unknown>,
 *   apiUrlTemplate?: string,
 *   viewUrlTemplate?: string,
 *   listUrlTemplate?: string,
 *   saveRecordIdSelector?: (payload: Record<string, any>) => unknown
 * }} AddEditUiRuntimeOptions
 */

/**
 * @typedef {RouteTemplateOptions & {
 *   routeRecordId?: import("vue").MaybeRefOrGetter<unknown>,
 *   apiUrlTemplate?: string,
 *   listUrlTemplate?: string,
 *   editUrlTemplate?: string
 * }} ViewUiRuntimeOptions
 */

/**
 * @typedef {RouteTemplateOptions & {
 *   items: import("vue").Ref<unknown>,
 *   isInitialLoading: import("vue").Ref<boolean>,
 *   recordIdSelector?: (record: Record<string, any>) => unknown,
 *   viewUrlTemplate?: string,
 *   editUrlTemplate?: string
 * }} ListUiRuntimeOptions
 */

/**
 * @typedef {object} AddEditOptions
 * @property {string} [ownershipFilter]
 * @property {string} [surfaceId]
 * @property {string} [access]
 * @property {CrudResource | null} [resource]
 * @property {ApiSuffix} [apiSuffix]
 * @property {QueryKeyFactory} [queryKeyFactory]
 * @property {string | string[]} [viewPermissions]
 * @property {string | string[]} [savePermissions]
 * @property {string} [readMethod]
 * @property {ReadEnabled} [readEnabled]
 * @property {string} [writeMethod]
 * @property {HttpClient} [client]
 * @property {Record<string, any> | null} [transport]
 * @property {RequestRecovery} [requestRecovery]
 * @property {string} [requestRecoveryLabel]
 * @property {string} [placementSource]
 * @property {string} [fallbackLoadError]
 * @property {string} [fallbackSaveError]
 * @property {string[]} [fieldErrorKeys]
 * @property {boolean} [clearOnRouteChange]
 * @property {object} [model]
 * @property {unknown} [input]
 * @property {MapLoadedToModel} [mapLoadedToModel]
 * @property {(model: any, context: Record<string, any>) => Record<string, any>} [buildRawPayload]
 * @property {(parsedInput: any, context: Record<string, any>) => unknown} [buildSavePayload]
 * @property {(payload: any, context: Record<string, any>) => unknown} [onSaveSuccess]
 * @property {boolean} [validationFeedback]
 * @property {RequestQueryParams} [requestQueryParams]
 * @property {string} [recordIdParam]
 * @property {import("vue").MaybeRefOrGetter<Record<string, unknown>> | null} [routeParams]
 * @property {import("vue").MaybeRefOrGetter<unknown>} [routeRecordId]
 * @property {string} [apiUrlTemplate]
 * @property {string} [viewUrlTemplate]
 * @property {string} [listUrlTemplate]
 * @property {(payload: Record<string, any>) => unknown} [saveRecordIdSelector]
 * @property {Record<string, string>} [messages]
 * @property {OperationRealtime | false | null} [realtime]
 */

/** @typedef {ReturnType<typeof import("./composables/records/useAddEdit.js").useAddEdit>} AddEditRuntime */

/**
 * @typedef {object} CommandOptions
 * @property {string} [ownershipFilter]
 * @property {string} [surfaceId]
 * @property {string} [access]
 * @property {ApiSuffix} [apiSuffix]
 * @property {string | string[]} [runPermissions]
 * @property {string} [writeMethod]
 * @property {HttpClient} [client]
 * @property {CrudResource | null} [resource]
 * @property {Record<string, any> | null} [transport]
 * @property {string} [placementSource]
 * @property {string} [fallbackRunError]
 * @property {string[]} [fieldErrorKeys]
 * @property {boolean} [clearOnRouteChange]
 * @property {object} [model]
 * @property {unknown} [input]
 * @property {CommandCoreOptions["buildRawPayload"]} [buildRawPayload]
 * @property {CommandCoreOptions["buildCommandPayload"]} [buildCommandPayload]
 * @property {CommandCoreOptions["buildCommandOptions"]} [buildCommandOptions]
 * @property {CommandCoreOptions["onRunSuccess"]} [onRunSuccess]
 * @property {CommandCoreOptions["onRunError"]} [onRunError]
 * @property {boolean} [suppressSuccessMessage]
 * @property {Record<string, string>} [messages]
 * @property {OperationRealtime | false | null} [realtime]
 */

/** @typedef {ReturnType<typeof import("./composables/useCommand.js").useCommand>} CommandRuntime */

/**
 * @typedef {object} ViewOptions
 * @property {CrudResource | null} [resource]
 * @property {string} [ownershipFilter]
 * @property {string} [surfaceId]
 * @property {string} [access]
 * @property {ApiSuffix} [apiSuffix]
 * @property {QueryKeyFactory} [queryKeyFactory]
 * @property {string | string[]} [viewPermissions]
 * @property {string} [readMethod]
 * @property {ReadEnabled} [readEnabled]
 * @property {HttpClient} [client]
 * @property {Record<string, any> | null} [transport]
 * @property {RequestRecovery} [requestRecovery]
 * @property {string} [requestRecoveryLabel]
 * @property {string} [placementSource]
 * @property {string} [fallbackLoadError]
 * @property {number[]} [notFoundStatuses]
 * @property {string} [notFoundMessage]
 * @property {object} [model]
 * @property {MapLoadedToModel} [mapLoadedToModel]
 * @property {RequestQueryParams} [requestQueryParams]
 * @property {RequestQueryParams} [requestFieldsets]
 * @property {string} [recordIdParam]
 * @property {import("vue").MaybeRefOrGetter<Record<string, unknown>> | null} [routeParams]
 * @property {import("vue").MaybeRefOrGetter<unknown>} [routeRecordId]
 * @property {string} [apiUrlTemplate]
 * @property {string} [listUrlTemplate]
 * @property {string} [editUrlTemplate]
 * @property {boolean} [includeRecordIdInQueryKey]
 * @property {OperationRealtime | false | null} [realtime]
 */

/** @typedef {ReturnType<typeof import("./composables/records/useView.js").useView>} ViewRuntime */

/**
 * @typedef {Omit<ViewOptions, "routeParams"> & {
 *   paramBinding?: Record<string, any> | null,
 *   route?: Record<string, any> | null
 * }} CrudViewOptions
 */

/**
 * @typedef {object} ListOptions
 * @property {string} [ownershipFilter]
 * @property {string} [surfaceId]
 * @property {string} [access]
 * @property {ApiSuffix} [apiSuffix]
 * @property {QueryKeyFactory} [queryKeyFactory]
 * @property {string | string[]} [viewPermissions]
 * @property {ReadEnabled} [readEnabled]
 * @property {string} [placementSource]
 * @property {string} [fallbackLoadError]
 * @property {unknown} [initialPageParam]
 * @property {PagedCollectionOptions["getNextPageParam"]} [getNextPageParam]
 * @property {PagedCollectionOptions["selectItems"]} [selectItems]
 * @property {HttpClient} [client]
 * @property {Record<string, any> | null} [transport]
 * @property {Record<string, any>} [requestOptions]
 * @property {Record<string, any>} [queryOptions]
 * @property {RequestRecovery} [requestRecovery]
 * @property {string} [requestRecoveryLabel]
 * @property {OperationRealtime | false | null} [realtime]
 * @property {string} [recordIdParam]
 * @property {(record: Record<string, any>) => unknown} [recordIdSelector]
 * @property {string} [viewUrlTemplate]
 * @property {string} [editUrlTemplate]
 * @property {Record<string, any> | null} [search]
 * @property {RequestQueryParams} [queryParams]
 * @property {import("vue").MaybeRef<Record<string, (routeValue: unknown, context: { initial?: boolean }) => unknown>> | null} [routeQueryValueResolvers]
 * @property {RequestQueryParams} [requestQueryParams]
 * @property {RequestQueryParams} [requestFieldsets]
 * @property {boolean | Record<string, any>} [syncToRoute]
 */

/** @typedef {ReturnType<typeof import("./composables/records/useList.js").useList>} ListRuntime */

/**
 * @typedef {ListOptions & {
 *   resource?: CrudResource | null,
 *   parentBinding?: Record<string, any> | null,
 *   route?: Record<string, any> | null
 * }} CrudListOptions
 */

/**
 * The options every list action definition shares.
 * @typedef {object} CrudListActionDefinition
 * @property {string} [key]
 * @property {string} [id]
 * @property {string} [label]
 * @property {string} [title]
 * @property {string} [icon]
 * @property {string} [color]
 */

/**
 * @typedef {CrudListActionDefinition & {
 *   variant?: string,
 *   confirmLabel?: string,
 *   run?: (context: Record<string, any>) => unknown,
 *   disabled?: boolean | ((context: Record<string, any>) => boolean)
 * }} CrudListBulkActionDefinition
 */

/**
 * @typedef {CrudListActionDefinition & {
 *   run?: (context: Record<string, any>) => unknown,
 *   visible?: boolean | ((context: Record<string, any>) => boolean),
 *   disabled?: boolean | ((context: Record<string, any>) => boolean),
 *   loading?: boolean | ((context: Record<string, any>) => boolean)
 * }} CrudListRowActionDefinition
 */

/**
 * @typedef {object} CrudListActionOptions
 * @property {(record: Record<string, any>, index: number) => unknown} [resolveRecordId]
 * @property {() => Record<string, any>} [resolveContext] What every action's context carries.
 */

/** @typedef {ReturnType<typeof import("./composables/useCrudListBulkActions.js").useCrudListBulkActions>} CrudListBulkActions */
/** @typedef {ReturnType<typeof import("./composables/useCrudListRowActions.js").useCrudListRowActions>} CrudListRowActions */

/**
 * @typedef {object} CrudListFiltersOptions
 * @property {Record<string, (value: unknown, filter: object) => string>} [labelResolvers]
 * @property {Record<string, (value: unknown, filter: object, values: object) => string>} [chipLabels]
 * @property {{ key: string, label: string, values?: Record<string, unknown>, resolveValues?: (context: Record<string, any>) => Record<string, unknown> }[]} [presets]
 */

/** @typedef {ReturnType<typeof import("./composables/useCrudListFilters.js").useCrudListFilters>} CrudListFilterRuntime */

/**
 * @typedef {object} CrudListFilterLookupsOptions
 * @property {Record<string, unknown>} [values]
 * @property {string} [recordIdParam]
 * @property {string[]} [queryKeyPrefix]
 * @property {string} [placementSourcePrefix]
 * @property {Record<string, RequestQueryParams>} [requestQueryParams]
 * @property {Record<string, (record: Record<string, any>, filter: object) => string>} [labelResolvers]
 */

/**
 * @typedef {object} CrudListParentTitleOptions
 * @property {ListRuntime} listRuntime
 * @property {CrudResource} [resource]
 * @property {string} [recordIdParam]
 * @property {string | string[]} [queryKeyPrefix]
 * @property {string} [placementSource]
 * @property {string} [fallbackLoadError]
 * @property {string} [notFoundMessage]
 * @property {Record<string, any> | null} [route]
 * @property {(options: ViewOptions) => ViewRuntime} [viewRuntimeFactory]
 */

/**
 * @typedef {object} CrudDeleteActionOptions
 * @property {CrudViewScreen} screen
 * @property {CrudResource | null} [resource]
 * @property {string} [resourceNamespace]
 * @property {import("vue").MaybeRef<string>} [apiUrlTemplate]
 * @property {string} [access]
 * @property {HttpClient} [client]
 * @property {string} [fallbackDeleteError]
 */

/** @typedef {ReturnType<typeof import("./composables/useCrudDeleteAction.js").useCrudDeleteAction>} CrudDeleteAction */

/**
 * @typedef {object} CrudAddEditOptions
 * @property {CrudResource | null} [resource]
 * @property {string} [operationName]
 * @property {Record<string, any>[]} [formFields]
 * @property {Record<string, any>} [addEditOptions]
 * @property {Record<string, any>} [saveSuccess]
 * @property {Record<string, any> | null} [fieldBinding]
 * @property {(fields: Record<string, any>[]) => Record<string, any>} [createModel]
 * @property {(model: any, context: Record<string, any>) => Record<string, any>} [buildPayload]
 * @property {MapLoadedToModel} [mapPayloadToModel] Without it a form maps a payload by its fields, or not at all when it reads nothing.
 * @property {unknown} [input]
 */

/** @typedef {ReturnType<typeof import("./composables/records/useCrudAddEdit.js").useCrudAddEdit>} CrudAddEditRuntime */

/**
 * @typedef {CrudAddEditOptions & {
 *   screen?: CrudAddEditScreen | null,
 *   mode?: import("vue").MaybeRef<string>,
 *   title?: import("vue").MaybeRef<string>,
 *   subtitle?: import("vue").MaybeRef<string>,
 *   saveLabel?: import("vue").MaybeRef<string>,
 *   cancelTo?: import("vue").MaybeRef<unknown>,
 *   preserveCancelQuery?: boolean
 * }} CrudAddEditScreenOptions
 */

/**
 * What `CrudAddEditScreen` renders: a `useCrudAddEditScreen()` result, or an object a page builds with these members.
 * @typedef {object} CrudAddEditScreen
 * @property {import("vue").MaybeRef<string>} [mode]
 * @property {import("vue").MaybeRef<string>} [title]
 * @property {import("vue").MaybeRef<string>} [subtitle]
 * @property {import("vue").MaybeRef<string>} [saveLabel]
 * @property {import("vue").MaybeRef<unknown>} [cancelTo]
 * @property {{ showFormSkeleton: boolean }} formRuntime
 * @property {Partial<AddEditRuntime>} addEdit
 * @property {Record<string, any>} formState
 * @property {(fieldKey: string) => string[]} resolveFieldErrors
 * @property {(target?: unknown) => unknown} resolveCancelTo
 */

/**
 * @typedef {object} CrudViewScreenOptions
 * @property {CrudResource | null} [resource]
 * @property {string} [resourceNamespace]
 * @property {string} [apiUrlTemplate]
 * @property {string} [recordIdParam]
 * @property {string} [titleFallbackFieldKey]
 * @property {import("vue").MaybeRef<string>} [listUrlTemplate]
 * @property {import("vue").MaybeRef<string>} [editUrlTemplate]
 * @property {string} [recordChangedEvent]
 * @property {RequestQueryParams} [requestQueryParams]
 * @property {RequestQueryParams} [requestFieldsets]
 * @property {ReadEnabled} [readEnabled]
 * @property {QueryKeyFactory} [queryKeyFactory]
 * @property {string} [requestRecoveryLabel]
 * @property {string} [fallbackLoadError]
 * @property {string} [notFoundMessage]
 */

/** @typedef {ReturnType<typeof import("./composables/useCrudViewScreen.js").useCrudViewScreen>} CrudViewScreen */

/**
 * @typedef {object} CrudListScreenOptions
 * @property {HttpClient} [client]
 * @property {CrudResource | null} [resource]
 * @property {string} [resourceNamespace]
 * @property {ApiSuffix} [apiSuffix]
 * @property {string} [recordIdParam]
 * @property {(record: Record<string, any>) => unknown} [recordIdSelector]
 * @property {string} [titleFallbackFieldKey]
 * @property {string} [viewUrlTemplate]
 * @property {string} [editUrlTemplate]
 * @property {string} [newUrlTemplate]
 * @property {string[]} [recordChangedEvents]
 * @property {Record<string, object>} [listFilters]
 * @property {CrudListBulkActionDefinition[]} [listBulkActions]
 * @property {readonly CrudListRowActionDefinition[]} [listRowActions]
 * @property {unknown} [syntheticRows]
 * @property {readonly string[]} [routeQueryBlacklist]
 * @property {RequestQueryParams} [requestQueryParams]
 * @property {RequestQueryParams} [requestFieldsets]
 * @property {ReadEnabled} [readEnabled]
 * @property {string} [requestRecoveryLabel]
 * @property {string} [fallbackLoadError]
 */

/** @typedef {ReturnType<typeof import("./composables/useCrudListScreen.js").useCrudListScreen>} CrudListScreen */

export {};
