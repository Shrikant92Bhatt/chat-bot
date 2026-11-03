// NOTE: Deliberately explicit (not `export * from ...`). Vercel's Rolldown-based
// function builder generates a lazy CJS `__esm`/`init_xxx` wrapper per source file
// whenever any `export *` barrel fans out across several interdependent files, to
// reconcile re-exported names at runtime - and that wrapper wiring has a bundler
// bug that throws `ReferenceError: init_chat_interface is not defined` at runtime
// for this specific barrel shape. Naming every export sidesteps that codegen path
// entirely: each export becomes a plain, eager `exports.Foo = ...` assignment with
// no lazy-init machinery involved.

export type {
  AIModelType,
  SelectableModel,
  ModelConfigDto,
  OpenRouterModelCatalogItem,
  MessageRole,
  AttachmentKind,
  ChatAttachment,
  ChatMessage,
  ChatThread,
  ChatStreamRequest,
  UsageRecordDto,
  MessageFeedbackRating,
  MessageFeedbackRequest,
  ThreadFeedbackMap,
  Project,
  ProjectFile,
  ProjectListResponse,
  ProjectFileListResponse,
  MemoryKind,
  MemoryEntry,
  UserSession,
  AIProviderResponse,
  StorageMetricsResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  SystemDiagnostics,
} from './interfaces/chat.interface';
export {
  SELECTABLE_MODELS,
  DEFAULT_MODEL_ID,
  AUTO_MODEL_ID,
  SELECTABLE_VIDEO_MODELS,
  DEFAULT_VIDEO_MODEL_ID,
} from './interfaces/chat.interface';

export type {
  UIComponentType,
  TextOrMarkdownData,
  TableData,
  ChartKind,
  ChartSeries,
  ChartData,
  WeatherForecastDay,
  WeatherHourlyPoint,
  WeatherCardData,
  StockCardData,
  StockChartPoint,
  StockChartData,
  NewsArticle,
  NewsCardData,
  MapMarker,
  MapData,
  ProductData,
  ProductCardData,
  ProductCarouselData,
  FileCardData,
  DocumentPreviewData,
  CodeBlockData,
  ErrorCardData,
  ConfirmationCardData,
  UIComponent,
  OrchestratorSource,
  KnownOrchestratorActionType,
  OrchestratorAction,
} from './interfaces/orchestrator.interface';

export type {
  ResearchPhase,
  ResearchSourceRef,
  ResearchStreamEvent,
  ResearchQueryState,
  ResearchTrace,
} from './interfaces/research.interface';
export { RESEARCH_EVENT_NAME } from './interfaces/research.interface';

export type { SystemLimitsDto, RateLimitUsageEntry } from './interfaces/system-limits.interface';

export type { UIComponentStatus, UIStreamEvent, PendingUIBlock } from './interfaces/ui-stream.interface';
export { UI_STREAM_EVENT_NAME } from './interfaces/ui-stream.interface';

export type {
  VideoGenerationMode,
  VideoModeInput,
  VideoProviderCapabilities,
  VideoGenerationValidationResult,
} from './interfaces/video.interface';
export {
  MIME_TO_ATTACHMENT_KIND,
  normalizeAttachmentKind,
  detectVideoMode,
  getOpenRouterVideoCapabilities,
  validateVideoGenerationRequest,
} from './interfaces/video.interface';

export type {
  ConnectorProviderId,
  ConnectorRiskTier,
  ConnectorCapability,
  ConnectionStatus,
  ConnectorToolSummary,
  ConnectorProviderSummary,
  ConnectionSummary,
  ConnectorSource,
  ConnectorToolError,
  ConnectorErrorCode,
  ConnectorToolResult,
  ConnectorDisplay,
  ConnectorDisplayItem,
  ConnectorResultCardData,
  ApprovalState,
  ApprovalSummary,
  ConnectorAuditEventSummary,
} from './interfaces/connector.interface';
export { CONNECTOR_APPROVAL_ACTION_PREFIX } from './interfaces/connector.interface';
