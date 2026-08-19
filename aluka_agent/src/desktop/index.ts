export {
  createDesktopRuntime,
  type CreateDesktopRuntimeOptions,
  type DesktopEventSink,
  type DesktopRuntime,
  type DesktopRuntimeEvent,
  type ExtensionInventory,
  type ExtensionListItem,
  type SkillListItem,
  type TimelineItem,
} from "./runtime.ts";
export {
  loadSettings,
  normalizePackagePaths,
  saveSettings,
  settingsPath,
  settingsView,
  type DesktopSettings,
  type ThemeId,
} from "./settings.ts";
export {
  createDesktopUI,
  type ExtensionUiRequest,
  type ExtensionUiResponse,
} from "./ui-bridge.ts";
export {
  previewModelsJson,
  readModelsJsonFile,
  readModelsJsonConfig,
  upsertCustomProviderInModelsJson,
  removeCustomProviderFromModelsJson,
  removeCustomModelFromModelsJson,
  setProviderApiKeyInModelsJson,
  clearProviderApiKeyInModelsJson,
  listModelOptions,
  ensureModelsJsonTemplate,
  type ModelsJsonModelView,
  type ModelsJsonPreview,
  type ModelsJsonProviderView,
  type ModelsJsonSourceView,
  type ModelsJsonConfigView,
  type ModelOptionView,
  type UpsertCustomProviderInput,
} from "./models-json.ts";
export {
  installNpmPackageToAgent,
  packageNameFromSpec,
  resolveExtensionEntry,
  agentNpmPackagesDir,
  type InstallNpmPackageOutcome,
} from "./packages.ts";
export {
  exportSessionToDir,
  renderSessionMarkdown,
  renderSessionJson,
  type SessionExportFormat,
  type SessionExportOutcome,
} from "./session-export.ts";
export {
  shareSessionViaGh,
  parseGhGistStdout,
  type SessionShareOutcome,
  type SessionShareResult,
} from "./session-share.ts";
export {
  buildSessionUsageView,
  sumUsageFromMessages,
  emptyUsageTotals,
  type SessionUsageTotals,
  type SessionUsageView,
} from "./session-usage.ts";
