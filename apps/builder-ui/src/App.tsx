import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type IsValidConnection,
  type Node,
  type NodeMouseHandler,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodeDrag,
  type OnNodesDelete,
  type OnReconnect,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  AlertCircle,
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleDot,
  Code2,
  Download,
  FileText,
  FileJson,
  Gauge,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Moon,
  Pin,
  Save,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Upload,
  UserCheck,
  GitCompare,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import {
  approveLangGraphSandbox,
  builderApiUrl,
  createFlowWorkspace,
  createRuntimeSession,
  createPromptAsset,
  createSchemaAsset,
  deletePromptAsset,
  deleteSchemaAsset,
  dockerRuntimeBuild,
  dockerRuntimeCancel,
  dockerRuntimeConfigurePorts,
  dockerRuntimeDown,
  dockerRuntimeHistory,
  dockerRuntimeInspect,
  dockerRuntimePrepareEnv,
  dockerRuntimeSmoke,
  dockerRuntimeStatus,
  dockerRuntimeUp,
  downloadGeneratedArtifactArchive,
  compareStudioRuns,
  exportStudioRun,
  exportFlowWorkspace,
  finishRuntimeSession,
  generateApprovedRuntime,
  generateFlow,
  generateLangGraphSandbox,
  generateRuntimeManifest,
  importFlowWorkspace,
  listGeneratedArtifact,
  listFlows,
  listLlmAdapters,
  listSandboxes,
  listStudioRuns,
  loadFlow,
  loadPromptAsset,
  loadRuntimeManifest,
  loadSchemaAsset,
  loadStudioRun,
  readLangGraphSandboxApprovalStatus,
  readGeneratedArtifactFile,
  runtimeEvents,
  runtimeTranscript,
  sandboxStatus,
  saveFlow,
  savePromptAsset,
  saveSchemaAsset,
  saveStudioRun,
  sendRuntimeTurn,
  startRuntimeSession,
  startSandbox,
  stopSandbox,
  validateFlow,
  validateRuntimeManifest,
} from "./api.ts";
import type {
  AgentFlow,
  EventView,
  FlowEdge,
  FlowDiagnostic,
  FlowNode,
  FlowSummary,
  FlowWorkspaceExport,
  ApprovedGenerateResult,
  DockerRuntimeHistory,
  DockerRuntimeHistoryQuery,
  DockerRuntimeOperation,
  DockerRuntimeOperationResult,
  DockerRuntimeProgressEvent,
  DockerRuntimeProgressStatus,
  DockerRuntimeStatus,
  GenerateResult,
  GeneratedArtifactFileContent,
  GeneratedArtifactListing,
  DockerRuntimeOperationStatus,
  LangGraphSandboxApproval,
  LangGraphSandboxApprovalStatus,
  LlmAdapterCatalogItem,
  LoadedFlow,
  LoadedRuntimeManifest,
  MessageView,
  RuntimeManifestGenerateResult,
  RuntimeManifestValidationResult,
  SandboxStatus,
  SessionView,
  StudioRunRecord,
  StudioRunSummary,
  StudioRunComparison,
  StudioRunQuery,
  StudioRunCausalAnalysis,
  StudioStateSnapshot,
  ValidationResult,
} from "./types.ts";
import "./styles.css";

type InspectorTab = "properties" | "files" | "validation" | "json" | "artifact" | "runtime" | "sandbox";
type StatusKind = "idle" | "ok" | "error" | "busy";
type ThemeMode = "light" | "dark";

interface DockerHistoryFilterForm {
  operation: DockerRuntimeOperation | "";
  status: DockerRuntimeOperationStatus | "";
  ok: "" | "true" | "false";
  search: string;
  progressStage: string;
  progressStatus: DockerRuntimeProgressStatus | "";
  from: string;
  to: string;
  limit: string;
}

interface StatusState {
  kind: StatusKind;
  message: string;
}

interface StudioScenario {
  id: string;
  label: string;
  input: string;
  tags: string[];
  isPinned: boolean;
  useNodePins: boolean;
  regressionThresholds: StudioScenarioRegressionThresholds;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  checkpoint: StudioScenarioCheckpoint | null;
}

interface StudioScenarioRegressionThresholds {
  tokenGrowthPct: number;
  costGrowthPct: number;
  durationGrowthPct: number;
}

interface StudioScenarioCheckpoint {
  sourceRunId: string;
  sourceSessionId: string;
  eventSeq: number;
  eventType: string;
  nodeId: string | null;
  snapshotSeq: number | null;
  status: string | null;
  phase: string | null;
  turn: number | null;
  state: unknown;
  input: unknown;
  output: unknown;
  createdAt: string;
  compatibility: StudioScenarioCheckpointCompatibility | null;
}

interface StudioScenarioCheckpointCompatibility {
  flowId: string;
  flowVersion: string;
  flowHash: string;
  projectHash: string | null;
  nodeId: string | null;
  nodeHash: string | null;
  checkedAt: string;
}

type StudioScenarioCheckpointCompatibilityLevel = "ok" | "warning" | "error";

interface StudioScenarioCheckpointCompatibilityStatus {
  level: StudioScenarioCheckpointCompatibilityLevel;
  label: string;
  reasons: string[];
}

interface StudioNodePin {
  id: string;
  nodeId: string;
  nodeType: string;
  runId: string;
  sessionId: string;
  eventSeq: number;
  eventType: string;
  nodeHash: string;
  input: unknown;
  output: unknown;
  createdAt: string;
  updatedAt: string;
}

interface StudioScenarioReplayFixture {
  format: "agent-flow-builder.replay-fixture.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
    flowHash: string;
    nodeCount: number;
    edgeCount: number;
  };
  scenario: StudioScenario;
  input: string;
  metadata: Record<string, unknown>;
  pins: {
    enabled: boolean;
    activeCount: number;
    staleCount: number;
    active: StudioNodePin[];
    stale: StudioNodePin[];
  };
}

interface StudioScenarioBatchResult {
  scenarioId: string;
  label: string;
  status: "ok" | "error";
  sessionId: string | null;
  runId: string | null;
  message: string;
  durationMs: number | null;
  comparison: StudioScenarioBatchComparison;
  completedAt: string;
}

interface StudioScenarioRunResult {
  sessionId: string;
  runId: string | null;
  message: string;
  durationMs: number;
}

type StudioScenarioBatchComparisonSeverity = "pass" | "warn" | "fail" | "missing" | "error";

interface StudioScenarioBatchComparison {
  baselineRunId: string | null;
  candidateRunId: string | null;
  severity: StudioScenarioBatchComparisonSeverity;
  verdict: string;
  reasons: string[];
}

type StudioScenarioBatchReportSeverity = "pass" | "warn" | "fail" | "error";

interface StudioScenarioBatchReportSummary {
  resultCount: number;
  okCount: number;
  errorCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  missingBaselineCount: number;
  comparisonErrorCount: number;
  severity: StudioScenarioBatchReportSeverity;
}

interface StudioScenarioBatchApproval {
  status: "approved";
  approvedAt: string;
  approvedBy: "local-user";
  reportHash: string;
  summarySeverity: StudioScenarioBatchReportSeverity;
  resultCount: number;
}

interface StudioScenarioBatchReport {
  format: "agent-flow-builder.scenario-batch-report.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
    nodeCount: number;
    edgeCount: number;
  };
  summary: StudioScenarioBatchReportSummary;
  results: StudioScenarioBatchResult[];
  approval: StudioScenarioBatchApproval | null;
  reportHash: string;
}

interface StudioNodePinDraft {
  nodeId: string;
  nodeType: string;
  runId: string;
  sessionId: string;
  eventSeq: number;
  eventType: string;
  nodeHash: string;
  input: unknown;
  output: unknown;
}

interface StudioNodeDebugContext {
  nodeId: string;
  status: string;
  causalRole: string;
  events: EventView[];
  latestEvent: EventView | null;
  errorEvent: EventView | null;
  latestSnapshot: StudioStateSnapshot | null;
  nodeState: unknown;
  input: unknown;
  output: unknown;
  diffs: StudioStateSnapshot["diff"];
  logs: string[];
  metrics: StudioNodeMetric[];
  spans: StudioNodeSpan[];
  diagnosis: StudioNodeDiagnosis;
}

interface StudioNodeMetric {
  label: string;
  value: string;
  detail: string;
}

interface StudioNodeSpan {
  name: string;
  status: string;
  durationMs: number | null;
  tokens: number | null;
  cost: string | null;
  eventSeq: number;
}

interface StudioNodeDiagnosis {
  severity: "ok" | "warning" | "error";
  title: string;
  probableCause: string;
  nextActions: string[];
  evidence: string[];
}

interface StudioNodeDiagnosisProfile {
  label: string;
  noExecutionCause: string;
  noExecutionActions: string[];
  failureCause: string;
  failureActions: string[];
  okCause: string;
  okActions: string[];
}

interface RenderedPromptPreview {
  promptId: string;
  path: string;
  version: string;
  content: string | null;
  variables: Record<string, unknown>;
  missingVariables: string[];
}

const nodeTypeOptions = [
  { type: "start", label: "Start", icon: Play },
  { type: "safety_gate", label: "Safety", icon: ShieldCheck },
  { type: "llm_prompt", label: "LLM", icon: Sparkles },
  { type: "llm_structured", label: "LLM JSON", icon: FileJson },
  { type: "code", label: "Code", icon: Code2 },
  { type: "switch", label: "Switch", icon: GitBranch },
  { type: "human_input", label: "Humano", icon: Send },
  { type: "http_request", label: "HTTP", icon: Terminal },
  { type: "transform_json", label: "Transform", icon: Boxes },
  { type: "database_query", label: "DB Query", icon: FileJson },
  { type: "database_save", label: "DB Save", icon: Download },
  { type: "file_extract", label: "Arquivo", icon: FileText },
  { type: "rag_retrieval", label: "RAG", icon: Search },
  { type: "approval_gate", label: "Approval", icon: UserCheck },
  { type: "scoring", label: "Scoring", icon: Gauge },
  { type: "analytics", label: "Analytics", icon: BarChart3 },
  { type: "end", label: "End", icon: CircleDot },
] as const;

const palette = nodeTypeOptions;
const themeStorageKey = "agent-flow-builder.theme";
const scenarioStorageKeyPrefix = "agent-flow-builder.studio-scenarios.";
const nodePinStorageKeyPrefix = "agent-flow-builder.studio-node-pins.";
const defaultStudioRegressionThresholds: StudioScenarioRegressionThresholds = {
  tokenGrowthPct: 20,
  costGrowthPct: 20,
  durationGrowthPct: 30,
};
const dockerHistoryOperationOptions: DockerRuntimeOperation[] = [
  "prepare_env",
  "configure_ports",
  "build",
  "up",
  "down",
  "smoke",
  "inspect",
];
const dockerHistoryStatusOptions: DockerRuntimeOperationStatus[] = ["idle", "running", "success", "error", "canceled"];
const dockerProgressStatusOptions: DockerRuntimeProgressStatus[] = ["running", "done", "error", "warning", "info", "canceled"];
const dockerHistoryFilterDefaults: DockerHistoryFilterForm = {
  operation: "",
  status: "",
  ok: "",
  search: "",
  progressStage: "",
  progressStatus: "",
  from: "",
  to: "",
  limit: "20",
};

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>("");
  const [loadedFlow, setLoadedFlow] = useState<LoadedFlow | null>(null);
  const [draftFlow, setDraftFlow] = useState<AgentFlow | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [activeSandboxes, setActiveSandboxes] = useState<SandboxStatus[]>([]);
  const [sandboxPort, setSandboxPort] = useState("8090");
  const [langGraphApprovalStatus, setLangGraphApprovalStatus] = useState<LangGraphSandboxApprovalStatus | null>(null);
  const [runtimeSession, setRuntimeSession] = useState<SessionView | null>(null);
  const [transcript, setTranscript] = useState<MessageView[]>([]);
  const [runtimeEventsData, setRuntimeEventsData] = useState<EventView[]>([]);
  const [studioStateSnapshots, setStudioStateSnapshots] = useState<StudioStateSnapshot[]>([]);
  const [selectedStudioEventSeq, setSelectedStudioEventSeq] = useState<number | null>(null);
  const [studioTimelineNodeFilter, setStudioTimelineNodeFilter] = useState("");
  const [studioRunCausalAnalysis, setStudioRunCausalAnalysis] = useState<StudioRunCausalAnalysis | null>(null);
  const [studioRuns, setStudioRuns] = useState<StudioRunSummary[]>([]);
  const [selectedStudioRunId, setSelectedStudioRunId] = useState("");
  const [studioRunSearch, setStudioRunSearch] = useState("");
  const [studioRunNodeFilter, setStudioRunNodeFilter] = useState("");
  const [studioRunStatusFilter, setStudioRunStatusFilter] = useState("");
  const [studioRunPhaseFilter, setStudioRunPhaseFilter] = useState("");
  const [studioRunHasErrorsOnly, setStudioRunHasErrorsOnly] = useState(false);
  const [studioRunCompletionFilter, setStudioRunCompletionFilter] = useState<"" | "complete" | "incomplete">("");
  const [studioRunMinDurationMsFilter, setStudioRunMinDurationMsFilter] = useState("");
  const [studioRunMaxDurationMsFilter, setStudioRunMaxDurationMsFilter] = useState("");
  const [studioRunCompareRunId, setStudioRunCompareRunId] = useState("");
  const [studioRunComparison, setStudioRunComparison] = useState<StudioRunComparison | null>(null);
  const [studioScenarios, setStudioScenarios] = useState<StudioScenario[]>([]);
  const [studioSelectedScenarioId, setStudioSelectedScenarioId] = useState("");
  const [studioScenarioLabel, setStudioScenarioLabel] = useState("");
  const [studioScenarioTags, setStudioScenarioTags] = useState("");
  const [studioScenarioUseNodePins, setStudioScenarioUseNodePins] = useState(false);
  const [studioScenarioRegressionThresholds, setStudioScenarioRegressionThresholds] =
    useState<StudioScenarioRegressionThresholds>({ ...defaultStudioRegressionThresholds });
  const [studioScenarioBatchResults, setStudioScenarioBatchResults] = useState<StudioScenarioBatchResult[]>([]);
  const [studioScenarioBatchApproval, setStudioScenarioBatchApproval] = useState<StudioScenarioBatchApproval | null>(null);
  const [studioNodePins, setStudioNodePins] = useState<StudioNodePin[]>([]);
  const [userMessage, setUserMessage] = useState("Olá, quero testar este fluxo.");
  const [runtimeManifest, setRuntimeManifest] = useState<LoadedRuntimeManifest | null>(null);
  const [flowValidation, setFlowValidation] = useState<ValidationResult | null>(null);
  const [manifestValidation, setManifestValidation] = useState<RuntimeManifestValidationResult | null>(null);
  const [manifestGeneration, setManifestGeneration] = useState<RuntimeManifestGenerateResult | null>(null);
  const [artifactListing, setArtifactListing] = useState<GeneratedArtifactListing | null>(null);
  const [artifactContent, setArtifactContent] = useState<GeneratedArtifactFileContent | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState("");
  const [dockerRuntimeStatusData, setDockerRuntimeStatusData] = useState<DockerRuntimeStatus | null>(null);
  const [dockerRuntimeOperation, setDockerRuntimeOperation] = useState<DockerRuntimeOperationResult | null>(null);
  const [dockerRuntimeBusy, setDockerRuntimeBusy] = useState<DockerRuntimeOperation | "refresh" | null>(null);
  const [dockerRuntimeUrl, setDockerRuntimeUrl] = useState("http://127.0.0.1:8080");
  const [dockerRuntimeHistoryData, setDockerRuntimeHistoryData] = useState<DockerRuntimeHistory | null>(null);
  const [dockerAutoRefresh, setDockerAutoRefresh] = useState(false);
  const [dockerHistoryFilterDraft, setDockerHistoryFilterDraft] =
    useState<DockerHistoryFilterForm>({ ...dockerHistoryFilterDefaults });
  const [dockerHistoryFilterApplied, setDockerHistoryFilterApplied] =
    useState<DockerHistoryFilterForm>({ ...dockerHistoryFilterDefaults });
  const [dockerApiPort, setDockerApiPort] = useState("8080");
  const [dockerPostgresPort, setDockerPostgresPort] = useState("5433");
  const [dockerRedisPort, setDockerRedisPort] = useState("6380");
  const [manifestOutDir, setManifestOutDir] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [promptContent, setPromptContent] = useState("");
  const [schemaContent, setSchemaContent] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [schemaDirty, setSchemaDirty] = useState(false);
  const [llmAdapters, setLlmAdapters] = useState<LlmAdapterCatalogItem[]>([]);
  const [status, setStatus] = useState<StatusState>({
    kind: "idle",
    message: "Builder API aguardando ação.",
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const fixtureInputRef = useRef<HTMLInputElement | null>(null);
  const firstPaletteButtonRef = useRef<HTMLButtonElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const refreshFlows = useCallback(async (silent = false) => {
    if (!silent) {
      setStatus({ kind: "busy", message: "Atualizando flows." });
    }
    try {
      const nextFlows = await listFlows();
      setFlows(nextFlows);
      const firstValid = nextFlows.find((item) => item.valid);
      setSelectedFlowId((current) => current || firstValid?.id || nextFlows[0]?.id || "");
      if (!silent) {
        setStatus({ kind: "ok", message: `${nextFlows.length} flow(s) encontrados.` });
      }
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void refreshFlows();
  }, [refreshFlows]);

  useEffect(() => {
    async function run() {
      try {
        const result = await listLlmAdapters();
        setLlmAdapters(result.adapters);
      } catch (error) {
        setStatus({ kind: "error", message: errorMessage(error) });
      }
    }
    void run();
  }, []);

  const refreshRuntimeManifest = useCallback(async (silent = false) => {
    if (!silent) {
      setStatus({ kind: "busy", message: "Carregando manifesto de runtime." });
    }
    try {
      const loaded = await loadRuntimeManifest();
      setRuntimeManifest(loaded);
      setManifestValidation(null);
      setManifestGeneration(null);
      setManifestOutDir((current) => current || `generated/${loaded.manifest.id}-bundle`);
      if (!silent) {
        setStatus({ kind: "ok", message: `${loaded.manifest.name} carregado.` });
      }
    } catch (error) {
      setRuntimeManifest(null);
      setManifestValidation(null);
      setManifestGeneration(null);
      if (!silent) {
        setStatus({ kind: "error", message: errorMessage(error) });
      }
    }
  }, []);

  useEffect(() => {
    void refreshRuntimeManifest(true);
  }, [refreshRuntimeManifest]);

  const refreshSandboxState = useCallback(
    async (flowId = selectedFlowId, silent = false) => {
      if (!flowId) {
        return;
      }
      if (!silent) {
        setStatus({ kind: "busy", message: `Atualizando sandbox de ${flowId}.` });
      }
      try {
        const [nextSandbox, listResult] = await Promise.all([sandboxStatus(flowId), listSandboxes()]);
        setSandbox(nextSandbox);
        setActiveSandboxes(listResult.sandboxes);
        if (!silent) {
          setStatus({ kind: "ok", message: nextSandbox.running ? `Sandbox ativo em ${nextSandbox.url}.` : "Sandbox parado." });
        }
      } catch (error) {
        if (!silent) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      }
    },
    [selectedFlowId],
  );

  const refreshStudioRuns = useCallback(
    async (flowId = selectedFlowId, query: StudioRunQuery = {}): Promise<StudioRunSummary[]> => {
    if (!flowId) {
      setStudioRuns([]);
      setSelectedStudioRunId("");
      return [];
    }
    const result = await listStudioRuns(flowId, query);
    setStudioRuns(result.runs);
    setSelectedStudioRunId((current) => (current && result.runs.some((run) => run.id === current) ? current : result.runs[0]?.id ?? ""));
    if (studioRunCompareRunId && !result.runs.some((run) => run.id === studioRunCompareRunId)) {
      setStudioRunCompareRunId("");
      setStudioRunComparison(null);
    }
    return result.runs;
  }, [selectedFlowId]);

  useEffect(() => {
    if (!selectedFlowId) {
      setLoadedFlow(null);
      setLangGraphApprovalStatus(null);
      setArtifactListing(null);
      setArtifactContent(null);
      setSelectedArtifactPath("");
      setDockerRuntimeStatusData(null);
      setDockerRuntimeOperation(null);
      setDockerRuntimeBusy(null);
      setDockerRuntimeHistoryData(null);
      setRuntimeSession(null);
      setTranscript([]);
      setRuntimeEventsData([]);
      setStudioStateSnapshots([]);
      setStudioRunCausalAnalysis(null);
      setStudioRuns([]);
      setSelectedStudioRunId("");
      setStudioRunCompletionFilter("");
      setStudioTimelineNodeFilter("");
      setDockerHistoryFilterDraft({ ...dockerHistoryFilterDefaults });
      setDockerHistoryFilterApplied({ ...dockerHistoryFilterDefaults });
      setStudioScenarios([]);
      setStudioSelectedScenarioId("");
      setStudioScenarioLabel("");
      setStudioScenarioTags("");
      setStudioScenarioUseNodePins(false);
      setStudioScenarioRegressionThresholds({ ...defaultStudioRegressionThresholds });
      setStudioNodePins([]);
      setStudioScenarioBatchResults([]);
      setStudioScenarioBatchApproval(null);
      return;
    }
    let active = true;
    async function run() {
      setStatus({ kind: "busy", message: `Carregando ${selectedFlowId}.` });
      try {
        const loaded = await loadFlow(selectedFlowId);
        if (!active) {
          return;
        }
        setStudioRunSearch("");
        setStudioRunStatusFilter("");
        setStudioRunPhaseFilter("");
        setStudioRunNodeFilter("");
        setStudioRunMinDurationMsFilter("");
        setStudioRunMaxDurationMsFilter("");
        setStudioRunHasErrorsOnly(false);
        setStudioRunCompletionFilter("");
        setStudioRunCompareRunId("");
        setStudioRunComparison(null);
        const scenarios = loadStudioScenarios(loaded.flow.id);
        const nodePins = loadStudioNodePins(loaded.flow.id);
        setStudioScenarios(scenarios);
        setStudioNodePins(nodePins);
        setStudioScenarioBatchResults([]);
        setStudioScenarioBatchApproval(null);
        const selectedScenario = scenarios.find((scenario) => scenario.isPinned) ?? scenarios[0] ?? null;
        setStudioSelectedScenarioId(selectedScenario?.id ?? "");
        if (selectedScenario) {
          setStudioScenarioLabel(selectedScenario.label);
          setStudioScenarioTags(selectedScenario.tags.join(", "));
          setStudioScenarioUseNodePins(selectedScenario.useNodePins);
          setStudioScenarioRegressionThresholds(selectedScenario.regressionThresholds);
          setUserMessage(selectedScenario.input);
        } else {
          setStudioScenarioLabel("");
          setStudioScenarioTags("");
          setStudioScenarioUseNodePins(false);
          setStudioScenarioRegressionThresholds({ ...defaultStudioRegressionThresholds });
        }
        const [nextSandbox, listResult, runList, approvalStatus] = await Promise.all([
          sandboxStatus(loaded.flow.id),
          listSandboxes(),
          listStudioRuns(loaded.flow.id),
          readLangGraphSandboxApprovalStatus(loaded.flow.id),
        ]);
        if (!active) {
          return;
        }
        setLangGraphApprovalStatus(approvalStatus);
        setLoadedFlow(loaded);
        setDraftFlow(loaded.flow);
        setIsDirty(false);
        setSelectedNodeId("start");
        setSelectedEdgeId("");
        setSelectedPromptId(loaded.flow.prompts[0]?.id ?? "");
        setSelectedSchemaId(loaded.flow.schemas[0]?.id ?? "");
        setPromptContent("");
        setSchemaContent("");
        setPromptDirty(false);
        setSchemaDirty(false);
        setFlowValidation(null);
        setArtifactListing(null);
        setArtifactContent(null);
        setSelectedArtifactPath("");
        setDockerRuntimeStatusData(null);
        setDockerRuntimeOperation(null);
        setDockerRuntimeBusy(null);
        setDockerRuntimeHistoryData(null);
        setDockerHistoryFilterDraft({ ...dockerHistoryFilterDefaults });
        setDockerHistoryFilterApplied({ ...dockerHistoryFilterDefaults });
        setRuntimeSession(null);
        setTranscript([]);
        setRuntimeEventsData([]);
        setStudioStateSnapshots([]);
        setStudioRunCausalAnalysis(null);
        setStudioRuns(runList.runs);
        setSelectedStudioRunId(runList.runs[0]?.id ?? "");
        setSandbox(nextSandbox);
        setActiveSandboxes(listResult.sandboxes);
        setStatus({ kind: "ok", message: `${loaded.flow.name} carregado.` });
      } catch (error) {
        if (!active) {
          return;
        }
        setLoadedFlow(null);
        setDraftFlow(null);
        setIsDirty(false);
        setSelectedNodeId("");
        setSelectedEdgeId("");
        setFlowValidation(null);
        setArtifactListing(null);
        setArtifactContent(null);
        setSelectedArtifactPath("");
        setDockerRuntimeStatusData(null);
        setDockerRuntimeOperation(null);
        setDockerRuntimeBusy(null);
        setDockerRuntimeHistoryData(null);
        setStudioStateSnapshots([]);
        setStudioRunCausalAnalysis(null);
        setStudioRuns([]);
        setSelectedStudioRunId("");
        setStudioRunSearch("");
        setStudioRunStatusFilter("");
        setStudioRunPhaseFilter("");
        setStudioRunNodeFilter("");
        setStudioRunMinDurationMsFilter("");
        setStudioRunMaxDurationMsFilter("");
        setStudioRunHasErrorsOnly(false);
        setStudioRunCompletionFilter("");
        setStudioRunCompareRunId("");
        setStudioRunComparison(null);
        setStudioTimelineNodeFilter("");
        setStudioScenarios([]);
        setStudioSelectedScenarioId("");
        setStudioScenarioLabel("");
        setStudioScenarioTags("");
        setStudioScenarioUseNodePins(false);
        setStudioScenarioRegressionThresholds({ ...defaultStudioRegressionThresholds });
        setStudioNodePins([]);
        setStudioScenarioBatchResults([]);
        setStudioScenarioBatchApproval(null);
        setDockerHistoryFilterDraft({ ...dockerHistoryFilterDefaults });
        setDockerHistoryFilterApplied({ ...dockerHistoryFilterDefaults });
        setUserMessage("");
        setLangGraphApprovalStatus(null);
        setStatus({ kind: "error", message: errorMessage(error) });
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [selectedFlowId]);

  useEffect(() => {
    if (!selectedFlowId || (inspectorTab !== "sandbox" && !sandbox?.running)) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshSandboxState(selectedFlowId, true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [inspectorTab, refreshSandboxState, sandbox?.running, selectedFlowId]);

  useEffect(() => {
    if (
      !dockerAutoRefresh ||
      inspectorTab !== "artifact" ||
      !artifactListing ||
      !artifactLooksLikeDockerRuntime(artifactListing) ||
      dockerRuntimeBusy !== null
    ) {
      return;
    }
    let active = true;
    async function pollDockerRuntime() {
      try {
        const result = await dockerRuntimeInspect(artifactListing!.outDir, dockerRuntimeUrl);
        if (!active) {
          return;
        }
        setDockerRuntimeStatusData(result);
        setDockerRuntimeOperation(result);
        setDockerRuntimeUrl(result.runtimeUrl);
        syncDockerPortFields(result);
        await refreshDockerHistoryData(artifactListing!.outDir, result.runtimeUrl);
      } catch {
        // Auto-refresh is best-effort; explicit actions still surface errors in the status bar.
      }
    }
    const timer = window.setInterval(() => {
      void pollDockerRuntime();
    }, 7000);
    void pollDockerRuntime();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    }, [artifactListing, dockerAutoRefresh, dockerRuntimeBusy, dockerRuntimeUrl, dockerHistoryFilterApplied, inspectorTab]);

  useEffect(() => {
    if (
      inspectorTab !== "artifact" ||
      dockerRuntimeBusy !== "build" ||
      !artifactListing ||
      !artifactLooksLikeDockerRuntime(artifactListing)
    ) {
      return;
    }
    let active = true;
    async function pollBuildProgress() {
      try {
        const result = await dockerRuntimeStatus(artifactListing!.outDir, dockerRuntimeUrl);
        if (!active) {
          return;
        }
        setDockerRuntimeStatusData(result);
        setDockerRuntimeUrl(result.runtimeUrl);
        syncDockerPortFields(result);
        if (result.lastOperation === "build" || result.progress?.length) {
          setDockerRuntimeOperation({
            ...result,
            operation: "build",
            ok: result.lastStatus === "success",
            message: result.lastStatus === "running" ? "Build Docker final em andamento." : dockerRuntimeStatusLabel(result, "build"),
          });
        }
      } catch {
        // The action request owns the visible error; polling only refreshes progress opportunistically.
      }
    }
    const timer = window.setInterval(() => {
      void pollBuildProgress();
    }, 1200);
    void pollBuildProgress();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [artifactListing, dockerRuntimeBusy, dockerRuntimeUrl, inspectorTab]);

  useEffect(() => {
    if (!selectedFlowId || !selectedPromptId) {
      setPromptContent("");
      setPromptDirty(false);
      return;
    }
    let active = true;
    async function run() {
      try {
        const asset = await loadPromptAsset(selectedFlowId, selectedPromptId);
        if (active) {
          setPromptContent(asset.content);
          setPromptDirty(false);
        }
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [selectedFlowId, selectedPromptId]);

  useEffect(() => {
    if (!selectedFlowId || !selectedSchemaId) {
      setSchemaContent("");
      setSchemaDirty(false);
      return;
    }
    let active = true;
    async function run() {
      try {
        const asset = await loadSchemaAsset(selectedFlowId, selectedSchemaId);
        if (active) {
          setSchemaContent(asset.content);
          setSchemaDirty(false);
        }
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [selectedFlowId, selectedSchemaId]);

  const studioTimelineEvents = useMemo(() => {
    if (!studioTimelineNodeFilter) {
      return runtimeEventsData;
    }
    return runtimeEventsData.filter((event) => event.node === studioTimelineNodeFilter);
  }, [runtimeEventsData, studioTimelineNodeFilter]);

  useEffect(() => {
    if (!studioTimelineEvents.length) {
      setSelectedStudioEventSeq(null);
      return;
    }
    if (selectedStudioEventSeq !== null && studioTimelineEvents.some((event) => event.seq === selectedStudioEventSeq)) {
      return;
    }
    setSelectedStudioEventSeq(studioTimelineEvents.at(-1)?.seq ?? null);
  }, [runtimeEventsData, selectedStudioEventSeq, studioTimelineEvents]);

  const selectedStudioEvent = useMemo(() => {
    if (!studioTimelineEvents.length) {
      return null;
    }
    if (selectedStudioEventSeq === null) {
      return studioTimelineEvents.at(-1) ?? null;
    }
    return studioTimelineEvents.find((event) => event.seq === selectedStudioEventSeq) ?? studioTimelineEvents.at(-1) ?? null;
  }, [runtimeEventsData, selectedStudioEventSeq, studioTimelineEvents]);

  const studioRunCausalContext = useMemo(
    () => studioRunCausalAnalysis ?? buildStudioRunCausalAnalysis(draftFlow, runtimeEventsData),
    [draftFlow, runtimeEventsData, studioRunCausalAnalysis],
  );

  const selectedStateSnapshot = useMemo(() => {
    if (!studioStateSnapshots.length || !selectedStudioEvent) {
      return null;
    }
    return studioStateSnapshots.find((snapshot) => snapshot.seq === selectedStudioEvent.seq) ?? studioStateSnapshots.at(-1) ?? null;
  }, [selectedStudioEvent, studioStateSnapshots]);

  const activeStudioNodeId = selectedStudioEvent?.node ?? runtimeEventsData.at(-1)?.node ?? "";
  const canGenerateApprovedRuntime = langGraphApprovalStatus?.status === "approved";
  const langGraphApprovalLabel = langGraphApprovalStatusLabel(langGraphApprovalStatus);
  const langGraphApprovalClass = langGraphApprovalStatusClass(langGraphApprovalStatus);

  const graph = useMemo(
    () => toReactFlowGraph(
      draftFlow ?? undefined,
      selectedNodeId,
      selectedEdgeId,
      runtimeEventsData,
      activeStudioNodeId,
      studioRunCausalContext,
    ),
    [activeStudioNodeId, draftFlow, runtimeEventsData, selectedEdgeId, selectedNodeId, studioRunCausalContext],
  );

  const selectedNode = useMemo(() => {
    if (!draftFlow || !selectedNodeId) {
      return null;
    }
    if (selectedNodeId === "start" || selectedNodeId === "end") {
      return {
        id: selectedNodeId,
        type: selectedNodeId,
        description: selectedNodeId === "start" ? "Entrada do grafo" : "Saída do grafo",
      };
    }
    return draftFlow.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [draftFlow, selectedNodeId]);

  const selectedEdgeIndex = useMemo(() => edgeIndexFromId(selectedEdgeId), [selectedEdgeId]);

  const selectedEdge = useMemo(() => {
    if (!draftFlow || selectedEdgeIndex < 0) {
      return null;
    }
    return draftFlow.edges[selectedEdgeIndex] ?? null;
  }, [draftFlow, selectedEdgeIndex]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
      setSelectedEdgeId("");
      if (inspectorTab === "sandbox") {
        setStudioTimelineNodeFilter(node.id);
        const latestNodeEvent = runtimeEventsData.filter((event) => event.node === node.id).at(-1);
        if (latestNodeEvent) {
          setSelectedStudioEventSeq(latestNodeEvent.seq);
        }
        return;
      }
      setInspectorTab("properties");
    },
    [inspectorTab, runtimeEventsData],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    setSelectedNodeId("");
    setSelectedEdgeId(edge.id);
    setInspectorTab("properties");
  }, []);

  function updateDraft(mutator: (flow: AgentFlow) => AgentFlow) {
    setDraftFlow((current) => {
      if (!current) {
        return current;
      }
      const next = mutator(current);
      if (next !== current) {
        setIsDirty(true);
        setFlowValidation(null);
        setStudioScenarioBatchResults([]);
        setStudioScenarioBatchApproval(null);
      }
      return next;
    });
  }

  function updateFlowField<K extends keyof Pick<AgentFlow, "name" | "version">>(key: K, value: AgentFlow[K]) {
    updateDraft((flow) => ({ ...flow, [key]: value }));
  }

  function updateFlowLlmAdapter(adapterId: string) {
    updateDraft((flow) => {
      const adapter = llmAdapters.find((item) => item.id === adapterId);
      return {
        ...flow,
        llm: {
          ...flow.llm,
          adapter: adapterId,
          model: adapter?.defaultModel || flow.llm.model,
          apiKeyEnv: adapter?.apiKeyEnv ?? flow.llm.apiKeyEnv,
          baseUrlEnv: adapter?.baseUrlEnv ?? flow.llm.baseUrlEnv,
          mockEnv: adapter?.mockEnv ?? flow.llm.mockEnv,
        },
      };
    });
  }

  function updateFlowLlmField(key: keyof AgentFlow["llm"], value: string) {
    updateDraft((flow) => ({
      ...flow,
      llm: {
        ...flow.llm,
        [key]: value.trim() ? value : undefined,
      },
    }));
  }

  function updateNodeField(nodeId: string, key: keyof FlowNode, value: string) {
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        return {
          ...node,
          [key]: value.trim() ? value : undefined,
        };
      }),
    }));
  }

  function updateNodeNumberField(nodeId: string, key: keyof FlowNode, value: string) {
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const nextValue = Number(value);
        return {
          ...node,
          [key]: value.trim() && Number.isFinite(nextValue) ? nextValue : undefined,
        };
      }),
    }));
  }

  function updateNodeLlmAdapter(nodeId: string, adapterId: string) {
    updateDraft((flow) => {
      const adapter = llmAdapters.find((item) => item.id === adapterId);
      return {
        ...flow,
        nodes: flow.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          return {
            ...node,
            llm: {
              ...(node.llm ?? {}),
              adapter: adapterId,
              model: adapter?.defaultModel ?? String(node.llm?.model ?? flow.llm.model),
            },
          };
        }),
      };
    });
  }

  function updateNodeLlmField(nodeId: string, key: "model", value: string) {
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        return {
          ...node,
          llm: {
            ...(node.llm ?? { adapter: flow.llm.adapter }),
            [key]: value.trim() ? value : undefined,
          },
        };
      }),
    }));
  }

  function handleAddNode(type: string) {
    if (!draftFlow) {
      return;
    }
    const node = createDefaultNode(draftFlow, type);
    updateDraft((flow) => ({
      ...flow,
      nodes: [...flow.nodes, node],
    }));
    setSelectedNodeId(node.id);
    setSelectedEdgeId("");
    setInspectorTab("properties");
    setStatus({ kind: "ok", message: `Nó ${node.id} criado.` });
  }

  function handleNodeIdChange(currentId: string, nextValue: string) {
    const nextId = nextValue.trim();
    if (isVirtualNodeId(currentId) || nextId === currentId) {
      return;
    }
    if (!isValidNodeId(nextId)) {
      setStatus({ kind: "error", message: "ID do nó deve usar letras, números, _ ou -." });
      return;
    }
    updateDraft((flow) => {
      if (flow.nodes.some((node) => node.id === nextId) || isVirtualNodeId(nextId)) {
        setStatus({ kind: "error", message: `Já existe um nó com ID ${nextId}.` });
        return flow;
      }
      setSelectedNodeId(nextId);
      setStatus({ kind: "ok", message: `Nó ${currentId} renomeado para ${nextId}.` });
      return {
        ...flow,
        nodes: flow.nodes.map((node) => (node.id === currentId ? { ...node, id: nextId } : node)),
        edges: flow.edges.map((edge) => ({
          ...edge,
          from: edge.from === currentId ? nextId : edge.from,
          to: edge.to === currentId ? nextId : edge.to,
        })),
      };
    });
  }

  function handleNodeTypeChange(nodeId: string, type: string) {
    if (isVirtualNodeId(nodeId)) {
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) => (node.id === nodeId ? applyNodeTypeDefaults({ ...node, type }, flow) : node)),
    }));
  }

  function handleDeleteNode(nodeId: string) {
    if (isVirtualNodeId(nodeId)) {
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.filter((node) => node.id !== nodeId),
      edges: flow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }));
    setSelectedNodeId("");
    setSelectedEdgeId("");
    setStatus({ kind: "ok", message: `Nó ${nodeId} removido.` });
  }

  function handleDeleteEdge(edgeIndex: number) {
    if (edgeIndex < 0) {
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      edges: flow.edges.filter((_edge, index) => index !== edgeIndex),
    }));
    setSelectedEdgeId("");
    setStatus({ kind: "ok", message: "Aresta removida." });
  }

  function updateEdgeField(edgeIndex: number, key: keyof FlowEdge, value: string) {
    updateDraft((flow) => ({
      ...flow,
      edges: flow.edges.map((edge, index) => {
        if (index !== edgeIndex) {
          return edge;
        }
        return {
          ...edge,
          [key]: value.trim() ? value : undefined,
        };
      }),
    }));
  }

  function updateEdgeEndpoint(edgeIndex: number, key: "from" | "to", value: string) {
    updateDraft((flow) => ({
      ...flow,
      edges: flow.edges.map((edge, index) => {
        if (index !== edgeIndex) {
          return edge;
        }
        const nextEdge = { ...edge, [key]: value };
        if (!nextEdge.from || !nextEdge.to || nextEdge.from === nextEdge.to) {
          setStatus({ kind: "error", message: "Aresta precisa ligar dois nós diferentes." });
          return edge;
        }
        setSelectedEdgeId(edgeId(nextEdge, index));
        return nextEdge;
      }),
    }));
  }

  const handleConnect: OnConnect = useCallback((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      setStatus({ kind: "error", message: "Aresta precisa ligar dois nós diferentes." });
      return;
    }
    updateDraft((flow) => {
      if (flow.edges.some((edge) => edge.from === connection.source && edge.to === connection.target && !edge.condition)) {
        setStatus({ kind: "error", message: "Essa aresta já existe sem condição." });
        return flow;
      }
      setStatus({ kind: "ok", message: `Aresta ${connection.source} -> ${connection.target} criada.` });
      return {
        ...flow,
        edges: [...flow.edges, { from: connection.source!, to: connection.target! }],
      };
    });
  }, []);

  const handleReconnect: OnReconnect = useCallback((oldEdge, connection) => {
    const edgeIndex = edgeIndexFromId(oldEdge.id);
    if (edgeIndex < 0 || !connection.source || !connection.target || connection.source === connection.target) {
      setStatus({ kind: "error", message: "Reconexão inválida." });
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      edges: flow.edges.map((edge, index) =>
        index === edgeIndex ? { ...edge, from: connection.source!, to: connection.target! } : edge,
      ),
    }));
    setSelectedEdgeId(edgeId({ from: connection.source, to: connection.target }, edgeIndex));
    setStatus({ kind: "ok", message: `Aresta reconectada para ${connection.source} -> ${connection.target}.` });
  }, []);

  const handleNodesDelete: OnNodesDelete = useCallback((nodes) => {
    const nodeIds = nodes.map((node) => node.id).filter((id) => !isVirtualNodeId(id));
    if (!nodeIds.length) {
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.filter((node) => !nodeIds.includes(node.id)),
      edges: flow.edges.filter((edge) => !nodeIds.includes(edge.from) && !nodeIds.includes(edge.to)),
    }));
    setSelectedNodeId("");
    setSelectedEdgeId("");
  }, []);

  const handleEdgesDelete: OnEdgesDelete = useCallback((edges) => {
    const edgeIndexes = new Set(edges.map((edge) => edgeIndexFromId(edge.id)).filter((index) => index >= 0));
    if (!edgeIndexes.size) {
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      edges: flow.edges.filter((_edge, index) => !edgeIndexes.has(index)),
    }));
    setSelectedEdgeId("");
  }, []);

  const handleNodeDragStop: OnNodeDrag = useCallback((_event, node) => {
    if (isVirtualNodeId(node.id)) {
      return;
    }
    updateDraft((flow) => ({
      ...flow,
      nodes: flow.nodes.map((flowNode) =>
        flowNode.id === node.id ? { ...flowNode, position: { x: node.position.x, y: node.position.y } } : flowNode,
      ),
    }));
  }, []);

  const isConnectionValid: IsValidConnection = useCallback((connection) => {
    return Boolean(connection.source && connection.target && connection.source !== connection.target);
  }, []);

  async function handleSaveFlow() {
    if (!selectedFlowId || !draftFlow) {
      return;
    }
    setStatus({ kind: "busy", message: `Salvando ${selectedFlowId}.` });
    try {
      const saved = await saveFlow(selectedFlowId, draftFlow);
      setLoadedFlow(saved);
      setDraftFlow(saved.flow);
      setIsDirty(false);
      setFlowValidation(null);
      await refreshFlows(true);
      setStatus({ kind: "ok", message: `${saved.flow.name} salvo em ${saved.path}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function saveDirtyAssets() {
    if (!selectedFlowId) {
      return;
    }
    if (promptDirty && selectedPromptId) {
      const savedPrompt = await savePromptAsset(selectedFlowId, selectedPromptId, promptContent);
      setPromptContent(savedPrompt.content);
      setPromptDirty(false);
      setFlowValidation(null);
    }
    if (schemaDirty && selectedSchemaId) {
      const savedSchema = await saveSchemaAsset(selectedFlowId, selectedSchemaId, schemaContent);
      setSchemaContent(savedSchema.content);
      setSchemaDirty(false);
      setFlowValidation(null);
    }
  }

  async function saveCurrentWorkspaceIfNeeded() {
    if (!selectedFlowId) {
      return;
    }
    if (isDirty && draftFlow) {
      const saved = await saveFlow(selectedFlowId, draftFlow);
      setLoadedFlow(saved);
      setDraftFlow(saved.flow);
      setIsDirty(false);
      await refreshFlows(true);
    }
    await saveDirtyAssets();
  }

  async function handleSaveWorkspace() {
    if (!selectedFlowId) {
      return;
    }
    if (!isDirty && !promptDirty && !schemaDirty) {
      setStatus({ kind: "ok", message: "Workspace já está salvo." });
      return;
    }
    setStatus({ kind: "busy", message: `Salvando workspace ${selectedFlowId}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      setStatus({ kind: "ok", message: `Workspace ${selectedFlowId} salvo.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleExportFlow() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Exportando ${selectedFlowId}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const workspace = await exportFlowWorkspace(selectedFlowId);
      downloadJsonFile(`${workspace.flow.id}-flow-workspace.json`, workspace);
      setStatus({
        kind: "ok",
        message: `Workspace ${workspace.flow.id} exportado com ${workspace.prompts.length} prompt(s) e ${workspace.schemas.length} schema(s).`,
      });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  function handleStudioScenarioFixtureImportClick() {
    fixtureInputRef.current?.click();
  }

  async function handleCreateFlow() {
    const rawId = window.prompt("ID do novo flow", "novo-agente");
    const flowId = rawId?.trim();
    if (!flowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Criando flow ${flowId}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const created = await createFlowWorkspace(flowId);
      await refreshFlows(true);
      setSelectedFlowId(created.flow.id);
      setLoadedFlow({ path: created.path, flow: created.flow });
      setDraftFlow(created.flow);
      setIsDirty(false);
      setSelectedNodeId(created.flow.nodes[0]?.id ?? "");
      setSelectedEdgeId("");
      setSelectedPromptId(created.flow.prompts[0]?.id ?? "");
      setSelectedSchemaId(created.flow.schemas[0]?.id ?? "");
      setPromptContent(created.prompts[0]?.content ?? "");
      setSchemaContent(created.schemas[0]?.content ?? "");
      setPromptDirty(false);
      setSchemaDirty(false);
      setFlowValidation(null);
      setArtifactListing(null);
      setArtifactContent(null);
      setSelectedArtifactPath("");
      setInspectorTab("properties");
      setStatus({ kind: "ok", message: `Flow ${created.flow.id} criado em ${created.path}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setStatus({ kind: "busy", message: `Importando ${file.name}.` });
    try {
      if ((isDirty || promptDirty || schemaDirty) && !window.confirm("Há alterações locais não salvas. Continuar importação?")) {
        setStatus({ kind: "idle", message: "Importação cancelada." });
        return;
      }
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isFlowWorkspaceExport(parsed)) {
        throw new Error("Arquivo não é um workspace de flow válido.");
      }
      const exists = flows.some((flow) => flow.id === parsed.flow.id);
      const overwrite = exists ? window.confirm(`Flow ${parsed.flow.id} já existe. Substituir?`) : false;
      if (exists && !overwrite) {
        setStatus({ kind: "idle", message: "Importação cancelada." });
        return;
      }
      const imported = await importFlowWorkspace(parsed, overwrite);
      await refreshFlows(true);
      setSelectedFlowId(imported.flow.id);
      setStatus({
        kind: "ok",
        message: `Workspace ${imported.flow.id} importado em ${imported.path}.`,
      });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleImportStudioScenarioFixtureFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!selectedFlowId || !draftFlow) {
      setStatus({ kind: "error", message: "Selecione um flow para importar fixture." });
      return;
    }
    setStatus({ kind: "busy", message: `Importando fixture ${file.name}.` });
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const fixture = normalizeStudioScenarioReplayFixture(parsed);
      if (!fixture) {
        throw new Error("Arquivo não é uma fixture de replay válida.");
      }
      if (fixture.flow.id && fixture.flow.id !== selectedFlowId) {
        const confirmed = window.confirm(`Fixture é do flow ${fixture.flow.id}. Importar no flow atual ${selectedFlowId}?`);
        if (!confirmed) {
          setStatus({ kind: "idle", message: "Importação de fixture cancelada." });
          return;
        }
      }
      const now = new Date().toISOString();
      const importedScenario = normalizeScenarioDefaults({
        ...fixture.scenario,
        id: `scenario-fixture-${Date.now()}`,
        input: fixture.input,
        isPinned: false,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
      });
      const importedPins = importedStudioFixturePins(fixture, now);
      const nextScenarios = sortScenarios([importedScenario, ...studioScenarios]);
      persistStudioScenarios(selectedFlowId, nextScenarios);
      setStudioScenarioBatchResults([]);
      setStudioScenarioBatchApproval(null);
      if (importedPins.length > 0) {
        const pinsByNode = new Map(studioNodePins.map((pin) => [pin.nodeId, pin]));
        for (const pin of importedPins) {
          pinsByNode.set(pin.nodeId, pin);
        }
        persistStudioNodePins(selectedFlowId, Array.from(pinsByNode.values()));
      }
      setStudioSelectedScenarioId(importedScenario.id);
      setStudioScenarioLabel(importedScenario.label);
      setStudioScenarioTags(importedScenario.tags.join(", "));
      setStudioScenarioUseNodePins(importedScenario.useNodePins);
      setStudioScenarioRegressionThresholds(importedScenario.regressionThresholds);
      setUserMessage(importedScenario.input);
      setStatus({ kind: "ok", message: `Fixture "${importedScenario.label}" importada com ${importedPins.length} pin(s).` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleSavePrompt() {
    if (!selectedFlowId || !selectedPromptId) {
      return;
    }
    setStatus({ kind: "busy", message: `Salvando prompt ${selectedPromptId}.` });
    try {
      const saved = await savePromptAsset(selectedFlowId, selectedPromptId, promptContent);
      setPromptContent(saved.content);
      setPromptDirty(false);
      setFlowValidation(null);
      setStatus({ kind: "ok", message: `Prompt salvo em ${saved.path}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleSaveSchema() {
    if (!selectedFlowId || !selectedSchemaId) {
      return;
    }
    setStatus({ kind: "busy", message: `Salvando schema ${selectedSchemaId}.` });
    try {
      const saved = await saveSchemaAsset(selectedFlowId, selectedSchemaId, schemaContent);
      setSchemaContent(saved.content);
      setSchemaDirty(false);
      setFlowValidation(null);
      setStatus({ kind: "ok", message: `Schema salvo em ${saved.path}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleCreatePrompt(promptId: string) {
    const id = promptId.trim();
    if (!selectedFlowId || !id) {
      return;
    }
    setStatus({ kind: "busy", message: `Criando prompt ${id}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const created = await createPromptAsset(selectedFlowId, id);
      setLoadedFlow({ path: created.path, flow: created.flow });
      setDraftFlow(created.flow);
      setIsDirty(false);
      setSelectedPromptId(created.prompt?.id ?? id);
      setPromptContent(created.prompt?.content ?? "");
      setPromptDirty(false);
      setFlowValidation(null);
      await refreshFlows(true);
      setStatus({ kind: "ok", message: `Prompt criado em ${created.prompt?.path ?? `prompts/${id}.md`}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleDeletePrompt() {
    if (!selectedFlowId || !selectedPromptId) {
      return;
    }
    if (!window.confirm(`Remover prompt ${selectedPromptId}?`)) {
      return;
    }
    setStatus({ kind: "busy", message: `Removendo prompt ${selectedPromptId}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const removed = await deletePromptAsset(selectedFlowId, selectedPromptId);
      setLoadedFlow({ path: removed.path, flow: removed.flow });
      setDraftFlow(removed.flow);
      setIsDirty(false);
      setSelectedPromptId(removed.flow.prompts[0]?.id ?? "");
      setPromptContent("");
      setPromptDirty(false);
      setFlowValidation(null);
      await refreshFlows(true);
      setStatus({ kind: "ok", message: `Prompt ${removed.deleted.id} removido.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleCreateSchema(schemaId: string) {
    const id = schemaId.trim();
    if (!selectedFlowId || !id) {
      return;
    }
    setStatus({ kind: "busy", message: `Criando schema ${id}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const created = await createSchemaAsset(selectedFlowId, id);
      setLoadedFlow({ path: created.path, flow: created.flow });
      setDraftFlow(created.flow);
      setIsDirty(false);
      setSelectedSchemaId(created.schema?.id ?? id);
      setSchemaContent(created.schema?.content ?? "");
      setSchemaDirty(false);
      setFlowValidation(null);
      await refreshFlows(true);
      setStatus({ kind: "ok", message: `Schema criado em ${created.schema?.path ?? `schemas/${id}.schema.json`}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleDeleteSchema() {
    if (!selectedFlowId || !selectedSchemaId) {
      return;
    }
    if (!window.confirm(`Remover schema ${selectedSchemaId}?`)) {
      return;
    }
    setStatus({ kind: "busy", message: `Removendo schema ${selectedSchemaId}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const removed = await deleteSchemaAsset(selectedFlowId, selectedSchemaId);
      setLoadedFlow({ path: removed.path, flow: removed.flow });
      setDraftFlow(removed.flow);
      setIsDirty(false);
      setSelectedSchemaId(removed.flow.schemas[0]?.id ?? "");
      setSchemaContent("");
      setSchemaDirty(false);
      setFlowValidation(null);
      await refreshFlows(true);
      setStatus({ kind: "ok", message: `Schema ${removed.deleted.id} removido.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleValidate() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Validando ${selectedFlowId}.` });
    try {
      await saveCurrentWorkspaceIfNeeded();
      const result = await validateFlow(selectedFlowId);
      setFlowValidation(result);
      setInspectorTab("validation");
      setStatus({ kind: result.status === "ok" ? "ok" : "error", message: validationMessage(result) });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  function handleSelectDiagnostic(diagnostic: FlowDiagnostic) {
    if (diagnostic.nodeId) {
      setSelectedNodeId(diagnostic.nodeId);
      setSelectedEdgeId("");
      setInspectorTab("properties");
      return;
    }
    if (draftFlow && diagnostic.edgeIndex !== undefined && draftFlow.edges[diagnostic.edgeIndex]) {
      setSelectedNodeId("");
      setSelectedEdgeId(edgeId(draftFlow.edges[diagnostic.edgeIndex], diagnostic.edgeIndex));
      setInspectorTab("properties");
      return;
    }
    if (draftFlow && diagnostic.assetId) {
      if (draftFlow.prompts.some((prompt) => prompt.id === diagnostic.assetId)) {
        setSelectedPromptId(diagnostic.assetId);
        setInspectorTab("files");
        return;
      }
      if (draftFlow.schemas.some((schema) => schema.id === diagnostic.assetId)) {
        setSelectedSchemaId(diagnostic.assetId);
        setInspectorTab("files");
      }
    }
  }

  const dockerHistoryFilterHasChanges = useMemo(() => {
    return (
      dockerHistoryFilterDraft.operation !== dockerHistoryFilterApplied.operation ||
      dockerHistoryFilterDraft.status !== dockerHistoryFilterApplied.status ||
      dockerHistoryFilterDraft.ok !== dockerHistoryFilterApplied.ok ||
      dockerHistoryFilterDraft.search !== dockerHistoryFilterApplied.search ||
      dockerHistoryFilterDraft.progressStage !== dockerHistoryFilterApplied.progressStage ||
      dockerHistoryFilterDraft.progressStatus !== dockerHistoryFilterApplied.progressStatus ||
      dockerHistoryFilterDraft.from !== dockerHistoryFilterApplied.from ||
      dockerHistoryFilterDraft.to !== dockerHistoryFilterApplied.to ||
      dockerHistoryFilterDraft.limit !== dockerHistoryFilterApplied.limit
    );
  }, [dockerHistoryFilterDraft, dockerHistoryFilterApplied]);

function buildDockerHistoryQuery(filters: DockerHistoryFilterForm): { limit: number; query: Omit<DockerRuntimeHistoryQuery, "limit"> } {
    const parsedLimit = parsePositiveInteger(filters.limit);
    if (filters.limit.trim() && parsedLimit === undefined) {
      throw new Error("limit deve ser inteiro positivo.");
    }
    const from = toIsoDateTime(filters.from);
    const to = toIsoDateTime(filters.to);
    if (from && to && new Date(from) > new Date(to)) {
      throw new Error("from deve ser anterior ou igual a to.");
    }
    return {
      limit: parsedLimit ?? 20,
      query: {
        operation: filters.operation || undefined,
        status: filters.status || undefined,
        ok: filters.ok === "true" ? true : filters.ok === "false" ? false : undefined,
        search: filters.search.trim() || undefined,
        progressStage: filters.progressStage.trim() || undefined,
        progressStatus: filters.progressStatus || undefined,
        from,
        to,
      },
    };
  }

  function clearDockerHistoryFilter() {
    setDockerHistoryFilterDraft({ ...dockerHistoryFilterDefaults });
    setDockerHistoryFilterApplied({ ...dockerHistoryFilterDefaults });
    if (!artifactListing || !artifactLooksLikeDockerRuntime(artifactListing)) {
      setDockerRuntimeHistoryData(null);
      return;
    }
    void refreshDockerHistoryData(artifactListing.outDir, dockerRuntimeUrl, dockerHistoryFilterDefaults);
    setStatus({ kind: "ok", message: "Filtro de histórico Docker limpo." });
  }

  async function applyDockerHistoryFilter() {
    const nextFilters = { ...dockerHistoryFilterDraft };
    try {
      buildDockerHistoryQuery(nextFilters);
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      return;
    }
    setDockerHistoryFilterApplied(nextFilters);
    if (!artifactListing || !artifactLooksLikeDockerRuntime(artifactListing)) {
      setStatus({ kind: "ok", message: "Filtro de histórico Docker aplicado." });
      return;
    }
    await refreshDockerHistoryData(artifactListing.outDir, dockerRuntimeUrl, nextFilters);
    setStatus({ kind: "ok", message: "Filtro de histórico Docker aplicado." });
  }

  async function refreshDockerHistoryData(
    outDir: string,
    runtimeUrl: string,
    filters: DockerHistoryFilterForm = dockerHistoryFilterApplied,
  ) {
    try {
      const { limit, query } = buildDockerHistoryQuery(filters);
      const history = await dockerRuntimeHistory(outDir, runtimeUrl, limit, query);
      setDockerRuntimeHistoryData(history);
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function refreshGeneratedArtifact(outDir: string, preferredPath?: string): Promise<GeneratedArtifactListing> {
    const listing = await listGeneratedArtifact(outDir);
    setArtifactListing(listing);
    setDockerRuntimeOperation(null);
    if (artifactLooksLikeDockerRuntime(listing)) {
      try {
        const status = await dockerRuntimeStatus(listing.outDir, dockerRuntimeUrl);
        setDockerRuntimeStatusData(status);
        setDockerRuntimeUrl(status.runtimeUrl);
        syncDockerPortFields(status);
        await refreshDockerHistoryData(listing.outDir, status.runtimeUrl);
      } catch {
        setDockerRuntimeStatusData(null);
        setDockerRuntimeHistoryData(null);
      }
    } else {
      setDockerRuntimeStatusData(null);
      setDockerRuntimeHistoryData(null);
    }
    const nextPath =
      (preferredPath && listing.files.some((file) => file.path === preferredPath) ? preferredPath : "") ||
      (listing.files.some((file) => file.path === "README.md") ? "README.md" : "") ||
      listing.files[0]?.path ||
      "";
    setSelectedArtifactPath(nextPath);
    if (nextPath) {
      const file = await readGeneratedArtifactFile(listing.outDir, nextPath);
      setArtifactContent(file);
    } else {
      setArtifactContent(null);
    }
    return listing;
  }

  async function handleSelectArtifactFile(filePath: string) {
    if (!artifactListing) {
      return;
    }
    setSelectedArtifactPath(filePath);
    setStatus({ kind: "busy", message: `Carregando ${filePath}.` });
    try {
      const file = await readGeneratedArtifactFile(artifactListing.outDir, filePath);
      setArtifactContent(file);
      setStatus({ kind: "ok", message: `${file.path} carregado.` });
    } catch (error) {
      setArtifactContent(null);
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleRefreshDockerRuntime() {
    if (!artifactListing) {
      return;
    }
    setDockerRuntimeBusy("refresh");
    setStatus({ kind: "busy", message: `Atualizando status Docker de ${artifactListing.outDir}.` });
    try {
      const result = await dockerRuntimeStatus(artifactListing.outDir, dockerRuntimeUrl);
      setDockerRuntimeStatusData(result);
      setDockerRuntimeUrl(result.runtimeUrl);
      syncDockerPortFields(result);
      await refreshDockerHistoryData(artifactListing.outDir, result.runtimeUrl);
      setStatus({ kind: "ok", message: `Runtime Docker pronto para ${result.outDir}.` });
    } catch (error) {
      setDockerRuntimeStatusData(null);
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setDockerRuntimeBusy(null);
    }
  }

  async function handleDockerRuntimeAction(operation: DockerRuntimeOperation) {
    if (!artifactListing) {
      return;
    }
    const label = dockerOperationLabel(operation);
    setDockerRuntimeBusy(operation);
    setStatus({ kind: "busy", message: `${label} em ${artifactListing.outDir}.` });
    try {
      const result = await runDockerRuntimeOperation(operation, artifactListing.outDir, dockerRuntimeUrl);
      setDockerRuntimeOperation(result);
      setDockerRuntimeStatusData(result);
      setDockerRuntimeUrl(result.runtimeUrl);
      syncDockerPortFields(result);
      await refreshDockerHistoryData(artifactListing.outDir, result.runtimeUrl);
      setStatus({ kind: result.ok || result.lastStatus === "canceled" ? "ok" : "error", message: result.message });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setDockerRuntimeBusy(null);
    }
  }

  async function handleCancelDockerBuild() {
    if (!artifactListing) {
      return;
    }
    setStatus({ kind: "busy", message: `Cancelando build Docker de ${artifactListing.outDir}.` });
    try {
      const result = await dockerRuntimeCancel(artifactListing.outDir, dockerRuntimeUrl);
      setDockerRuntimeOperation(result);
      setDockerRuntimeStatusData(result);
      setDockerRuntimeUrl(result.runtimeUrl);
      syncDockerPortFields(result);
      await refreshDockerHistoryData(artifactListing.outDir, result.runtimeUrl);
      setStatus({ kind: "ok", message: result.message });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  function syncDockerPortFields(result: DockerRuntimeStatus) {
    setDockerApiPort(String(result.ports.api?.hostPort ?? 8080));
    setDockerPostgresPort(String(result.ports.postgres?.hostPort ?? 5433));
    setDockerRedisPort(String(result.ports.redis?.hostPort ?? 6380));
  }

  async function handleConfigureDockerPorts() {
    if (!artifactListing) {
      return;
    }
    setDockerRuntimeBusy("configure_ports");
    setStatus({ kind: "busy", message: `Atualizando portas Docker de ${artifactListing.outDir}.` });
    try {
      const result = await dockerRuntimeConfigurePorts(
        artifactListing.outDir,
        {
          api: parsePortInput(dockerApiPort, "API"),
          postgres: parsePortInput(dockerPostgresPort, "Postgres"),
          redis: parsePortInput(dockerRedisPort, "Redis"),
        },
        dockerRuntimeUrl,
      );
      setDockerRuntimeOperation(result);
      setDockerRuntimeStatusData(result);
      setDockerRuntimeUrl(result.runtimeUrl);
      syncDockerPortFields(result);
      await refreshDockerHistoryData(artifactListing.outDir, result.runtimeUrl);
      setStatus({ kind: "ok", message: result.message });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setDockerRuntimeBusy(null);
    }
  }

  async function handleRefreshArtifact() {
    if (!artifactListing) {
      return;
    }
    setStatus({ kind: "busy", message: `Atualizando artefato ${artifactListing.outDir}.` });
    try {
      const listing = await refreshGeneratedArtifact(artifactListing.outDir, selectedArtifactPath);
      setStatus({ kind: "ok", message: `Artefato atualizado com ${listing.files.length} arquivo(s).` });
    } catch (error) {
      setArtifactListing(null);
      setArtifactContent(null);
      setSelectedArtifactPath("");
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleDownloadArtifact() {
    if (!artifactListing) {
      return;
    }
    setStatus({ kind: "busy", message: `Preparando ${artifactListing.outDir}.zip.` });
    try {
      const blob = await downloadGeneratedArtifactArchive(artifactListing.outDir);
      downloadBlobFile(`${artifactBaseName(artifactListing.outDir)}.zip`, blob);
      setStatus({ kind: "ok", message: `Download preparado para ${artifactListing.outDir}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function refreshLangGraphApprovalStatus(flowId: string) {
    try {
      const status = await readLangGraphSandboxApprovalStatus(flowId);
      setLangGraphApprovalStatus(status);
      return;
    } catch (error) {
      const loaded = draftFlow ?? loadedFlow?.flow;
      const flowIdFromCurrent = loaded?.id ?? flowId;
      setLangGraphApprovalStatus({
        status: "invalid",
        flowId: flowIdFromCurrent,
        flowVersion: loaded?.version ?? "-",
        flowHash: "",
        approvalPath: "",
        reason: errorMessage(error),
        details: error,
      });
    }
  }

  async function handleGenerateApprovedRuntime() {
    if (!selectedFlowId) {
      return;
    }
    if (isDirty || promptDirty || schemaDirty) {
      setStatus({
        kind: "error",
        message: "Salve as alterações, gere/teste o pacote LangGraph e aprove o sandbox antes de criar a API Docker.",
      });
      return;
    }
    setStatus({ kind: "busy", message: `Gerando API Docker aprovada de ${selectedFlowId}.` });
    try {
      const result = await generateApprovedRuntime(selectedFlowId);
      await refreshLangGraphApprovalStatus(selectedFlowId);
      const listing = await refreshGeneratedArtifact(result.outDir, "README.md");
      setInspectorTab("artifact");
      setStatus({
        kind: "ok",
        message: `${approvedRuntimeMessage(result)} ${listing.files.length} arquivo(s) prontos.`,
      });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleGenerateLangGraphSandbox() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Gerando pacote LangGraph de ${selectedFlowId}.` });
    try {
      if (isDirty && draftFlow) {
        const saved = await saveFlow(selectedFlowId, draftFlow);
        setLoadedFlow(saved);
        setDraftFlow(saved.flow);
        setIsDirty(false);
        setFlowValidation(null);
      }
      await saveDirtyAssets();
      const result = await generateLangGraphSandbox(selectedFlowId);
      await refreshLangGraphApprovalStatus(selectedFlowId);
      const listing = await refreshGeneratedArtifact(result.outDir, "langgraph.json");
      setInspectorTab("artifact");
      setStatus({ kind: "ok", message: `${langGraphSandboxMessage(result)} ${listing.files.length} arquivo(s) prontos.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleApproveLangGraphSandbox() {
    if (!selectedFlowId) {
      return;
    }
    if (isDirty || promptDirty || schemaDirty) {
      setStatus({
        kind: "error",
        message: "Salve as alterações, gere/teste o pacote LangGraph e aprove somente a versão validada no LangSmith.",
      });
      return;
    }
    setStatus({ kind: "busy", message: `Aprovando sandbox LangGraph de ${selectedFlowId}.` });
    try {
      const approval = await approveLangGraphSandbox(selectedFlowId);
      setLangGraphApprovalStatus({
        status: "approved",
        flowId: approval.flowId,
        flowVersion: approval.flowVersion,
        flowHash: approval.flowHash,
        sandboxOutDir: approval.sandboxOutDir,
        approvedFor: approval.approvedFor,
        approvalPath: approval.approvalPath,
        approvedAt: approval.approvedAt,
        reason: "Aprovação registrada para geração da API Docker.",
      });
      setStatus({ kind: "ok", message: approvalMessage(approval) });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleValidateManifest() {
    setStatus({ kind: "busy", message: "Validando runtime.manifest.json." });
    try {
      const result = await validateRuntimeManifest();
      setManifestValidation(result);
      setStatus({ kind: "ok", message: manifestValidationMessage(result) });
    } catch (error) {
      setManifestValidation(null);
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleGenerateManifest() {
    setStatus({ kind: "busy", message: "Gerando bundle do manifesto." });
    try {
      const result = await generateRuntimeManifest(manifestOutDir.trim() || undefined);
      setManifestGeneration(result);
      const listing = await refreshGeneratedArtifact(result.outDir, "README.md");
      setInspectorTab("artifact");
      setStatus({ kind: "ok", message: `${manifestGenerateMessage(result)} ${listing.files.length} arquivo(s) prontos.` });
    } catch (error) {
      setManifestGeneration(null);
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleStartSandbox() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Gerando e iniciando sandbox de ${selectedFlowId}.` });
    try {
      const port = parseSandboxPort(sandboxPort);
      if (isDirty && draftFlow) {
        const saved = await saveFlow(selectedFlowId, draftFlow);
        setLoadedFlow(saved);
        setDraftFlow(saved.flow);
        setIsDirty(false);
      }
      await saveDirtyAssets();
      await generateFlow(selectedFlowId);
      const result = await startSandbox(selectedFlowId, port);
      setSandbox(result);
      const listResult = await listSandboxes();
      setActiveSandboxes(listResult.sandboxes);
      setRuntimeSession(null);
      setTranscript([]);
      setRuntimeEventsData([]);
      setStudioStateSnapshots([]);
      setStudioRunCausalAnalysis(null);
      setInspectorTab("sandbox");
      setStatus({ kind: "ok", message: `Sandbox ativo em ${result.url}.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleStopSandbox() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Parando sandbox de ${selectedFlowId}.` });
    try {
      const result = await stopSandbox(selectedFlowId);
      setSandbox(result);
      const listResult = await listSandboxes();
      setActiveSandboxes(listResult.sandboxes);
      setRuntimeSession(null);
      setTranscript([]);
      setRuntimeEventsData([]);
      setStudioStateSnapshots([]);
      setStudioRunCausalAnalysis(null);
      setStatus({ kind: "ok", message: "Sandbox parado." });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleRefreshSandbox() {
    await refreshSandboxState(selectedFlowId);
  }

  async function refreshRuntimeData(nextSession?: SessionView): Promise<StudioRunRecord | null> {
    const session = nextSession ?? runtimeSession;
    if (!draftFlow || !sandbox?.url || !session) {
      return null;
    }
    const [nextTranscript, nextEvents] = await Promise.all([
      runtimeTranscript(sandbox.url, draftFlow.api.resourceName, session.session_id),
      runtimeEvents(sandbox.url, draftFlow.api.resourceName, session.session_id),
    ]);
    setTranscript(nextTranscript);
    setRuntimeEventsData(nextEvents);
    setStudioRunCausalAnalysis(null);
    setSelectedStudioEventSeq(nextEvents.at(-1)?.seq ?? null);
    try {
      const saved = await saveStudioRun(draftFlow.id, {
        runtimeUrl: sandbox.url,
        resourceName: draftFlow.api.resourceName,
        session,
        transcript: nextTranscript,
        events: nextEvents,
        logs: sandbox.logs ?? [],
      });
      setStudioStateSnapshots(saved.stateSnapshots);
      await refreshStudioRuns(draftFlow.id, buildStudioRunQuery());
      setSelectedStudioRunId(saved.id);
      return saved;
    } catch {
      // Runtime execution should stay usable even if local trace persistence fails.
      return null;
    }
  }

  function buildStudioRunQuery(): StudioRunQuery {
    const minDurationMs = parseStudioRunDurationInput(studioRunMinDurationMsFilter);
    const maxDurationMs = parseStudioRunDurationInput(studioRunMaxDurationMsFilter);
    const isComplete =
      studioRunCompletionFilter === "complete"
        ? true
        : studioRunCompletionFilter === "incomplete"
          ? false
          : undefined;
    return {
      q: studioRunSearch.trim() || undefined,
      node: studioRunNodeFilter.trim() || undefined,
      status: studioRunStatusFilter || undefined,
      phase: studioRunPhaseFilter || undefined,
      hasErrors: studioRunHasErrorsOnly ? true : undefined,
      isComplete,
      minDurationMs,
      maxDurationMs,
    };
  }

  async function handleRefreshStudioRuns() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: "Atualizando runs locais." });
    try {
      const query = buildStudioRunQuery();
      const runs = await refreshStudioRuns(selectedFlowId, query);
      setStatus({ kind: "ok", message: `${runs.length} run(s) locais carregados.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleExportStudioRun() {
    if (!selectedFlowId || !selectedStudioRunId) {
      return;
    }
    setStatus({ kind: "busy", message: "Exportando run local." });
    try {
      const exported = await exportStudioRun(selectedFlowId, selectedStudioRunId);
      downloadJsonFile(`studio-run-${selectedStudioRunId}.json`, exported);
      setStatus({ kind: "ok", message: `Run ${selectedStudioRunId} exportado.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleCompareStudioRuns() {
    if (!selectedFlowId || !selectedStudioRunId || !studioRunCompareRunId) {
      return;
    }
    setStatus({ kind: "busy", message: "Comparando runs locais." });
    try {
      const comparison = await compareStudioRuns(selectedFlowId, studioRunCompareRunId, selectedStudioRunId);
      setStudioRunComparison(comparison);
      setStatus({ kind: "ok", message: `Comparação: ${comparison.leftRunId} x ${comparison.rightRunId}.` });
    } catch (error) {
      setStudioRunComparison(null);
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  function handleExportStudioRunComparison() {
    if (!studioRunComparison) {
      return;
    }
    setStatus({ kind: "busy", message: "Exportando comparação de runs." });
    const fileName = `studio-run-comparison-${studioRunComparison.leftRunId}-vs-${studioRunComparison.rightRunId}.json`;
    downloadJsonFile(fileName, studioRunComparison);
    setStatus({ kind: "ok", message: `Comparação ${studioRunComparison.leftRunId} x ${studioRunComparison.rightRunId} exportada.` });
  }

  function handleClearStudioRunComparison() {
    setStudioRunComparison(null);
    setStudioRunCompareRunId("");
  }

  function handleExportStudioScenarioFixture() {
    if (!selectedFlowId || !draftFlow) {
      return;
    }
    const selected = syncStudioScenarioSelection(studioScenarios, studioSelectedScenarioId);
    if (!selected) {
      setStatus({ kind: "error", message: "Selecione um cenário para exportar fixture." });
      return;
    }
    const activePins = activeStudioNodePins(studioNodePins, draftFlow);
    const stalePins = staleStudioNodePins(studioNodePins, draftFlow);
    const fixture = buildStudioScenarioReplayFixture(selectedFlowId, draftFlow, selected, activePins, stalePins);
    const fileName = `studio-fixture-${sanitizeFileNamePart(selected.label || selected.id)}.json`;
    downloadJsonFile(fileName, fixture);
    setStatus({ kind: "ok", message: `Fixture do cenário "${selected.label}" exportada.` });
  }

  async function handleLoadStudioRun(runId: string) {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Carregando run ${runId}.` });
    try {
      const run = await loadStudioRun(selectedFlowId, runId);
      setRuntimeSession(run.session);
      setTranscript(run.transcript);
      setRuntimeEventsData(run.events);
      setStudioStateSnapshots(run.stateSnapshots);
      setStudioRunCausalAnalysis(run.causalAnalysis);
      setStudioTimelineNodeFilter("");
      setSelectedStudioEventSeq(run.events.at(-1)?.seq ?? null);
      setSelectedStudioRunId(run.id);
      if (run.runtimeUrl) {
        setSandbox((current) => current ?? {
          flowId: run.flowId,
          running: false,
          port: null,
          pid: null,
          url: run.runtimeUrl,
          docsUrl: `${run.runtimeUrl.replace(/\/$/, "")}/docs`,
          runtimeDir: null,
          logs: run.logs,
        });
      }
      setStatus({ kind: "ok", message: `Run ${run.sessionId} carregado do histórico local.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  function resetScenarioForm() {
    setStudioScenarioLabel("");
    setStudioScenarioTags("");
    setStudioScenarioUseNodePins(false);
    setStudioScenarioRegressionThresholds({ ...defaultStudioRegressionThresholds });
  }

  function persistStudioScenarios(flowId: string, scenarios: StudioScenario[]): void {
    window.localStorage.setItem(scenarioStorageKey(flowId), JSON.stringify(scenarios));
    setStudioScenarios(scenarios);
  }

  function persistStudioNodePins(flowId: string, pins: StudioNodePin[]): void {
    window.localStorage.setItem(nodePinStorageKey(flowId), JSON.stringify(pins));
    setStudioNodePins(sortStudioNodePins(pins));
  }

  function syncStudioScenarioSelection(scenarios: StudioScenario[], selectedId: string): StudioScenario | null {
    return scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0] ?? null;
  }

  async function ensureSandboxRunningForScenario(): Promise<SandboxStatus> {
    if (!selectedFlowId) {
      throw new Error("Selecione um fluxo para executar cenário.");
    }
    if (sandbox?.running && sandbox.url) {
      return sandbox;
    }
    const port = parseSandboxPort(sandboxPort);
    const started = await startSandbox(selectedFlowId, port);
    setSandbox(started);
    setActiveSandboxes((await listSandboxes()).sandboxes);
    setRuntimeSession(null);
    setTranscript([]);
    setRuntimeEventsData([]);
    setStudioStateSnapshots([]);
    setStudioRunCausalAnalysis(null);
    return started;
  }

  async function handleSaveStudioScenario() {
    if (!selectedFlowId) {
      return;
    }
    const input = userMessage.trim();
    if (!input) {
      setStatus({ kind: "error", message: "Informe um texto de entrada para salvar o cenário." });
      return;
    }
    const label = studioScenarioLabel.trim() || `Cenário ${studioScenarios.length + 1}`;
    const tags = splitTags(studioScenarioTags);
    const now = new Date().toISOString();
    const nextScenarios = [...studioScenarios];

    if (studioSelectedScenarioId) {
      const index = nextScenarios.findIndex((item) => item.id === studioSelectedScenarioId);
      if (index === -1) {
        setStatus({ kind: "error", message: "Cenário selecionado não encontrado." });
        return;
      }
      const existing = nextScenarios[index];
      nextScenarios[index] = {
        ...existing,
        label,
        input,
        tags,
        useNodePins: studioScenarioUseNodePins,
        regressionThresholds: studioScenarioRegressionThresholds,
        updatedAt: now,
      };
    } else {
      const created: StudioScenario = {
        id: `scenario-${Date.now()}`,
        label,
        input,
        tags,
        isPinned: false,
        useNodePins: studioScenarioUseNodePins,
        regressionThresholds: studioScenarioRegressionThresholds,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        checkpoint: null,
      };
      nextScenarios.unshift(created);
      setStudioSelectedScenarioId(created.id);
    }

    persistStudioScenarios(selectedFlowId, sortScenarios(nextScenarios));
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
    setStudioScenarioLabel(label);
    setStudioScenarioTags(tags.join(", "));
    setStatus({ kind: "ok", message: "Cenário salvo." });
  }

  function handleSelectStudioScenario(scenarioId: string) {
    const scenarios = [...studioScenarios];
    const selected = syncStudioScenarioSelection(scenarios, scenarioId);
    if (selected) {
      setStudioSelectedScenarioId(selected.id);
      setStudioScenarioLabel(selected.label);
      setStudioScenarioTags(selected.tags.join(", "));
      setStudioScenarioUseNodePins(selected.useNodePins);
      setStudioScenarioRegressionThresholds(selected.regressionThresholds);
      setUserMessage(selected.input);
      setStatus({ kind: "ok", message: `Cenário "${selected.label}" selecionado.` });
    } else {
      setStudioSelectedScenarioId("");
      resetScenarioForm();
    }
  }

  function toggleStudioScenarioPin() {
    if (!selectedFlowId || !studioSelectedScenarioId) {
      return;
    }
    const pinned = studioScenarios.some((scenario) => scenario.id === studioSelectedScenarioId && scenario.isPinned);
    const nextScenarios = studioScenarios.map((scenario) => ({
      ...scenario,
      isPinned: scenario.id === studioSelectedScenarioId ? !pinned : false,
    }));
    persistStudioScenarios(selectedFlowId, sortScenarios(nextScenarios));
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
  }

  function handleStudioScenarioRegressionThresholdChange(
    key: keyof StudioScenarioRegressionThresholds,
    value: string,
  ) {
    setStudioScenarioRegressionThresholds((current) => ({
      ...current,
      [key]: normalizeRegressionThresholdInput(value, current[key]),
    }));
  }

  function handleDeleteStudioScenario() {
    if (!selectedFlowId || !studioSelectedScenarioId) {
      return;
    }
    const nextScenarios = studioScenarios.filter((scenario) => scenario.id !== studioSelectedScenarioId);
    const afterDelete = sortScenarios(nextScenarios);
    const nextPinned = afterDelete.find((scenario) => scenario.isPinned)?.id ?? afterDelete[0]?.id ?? "";
    persistStudioScenarios(selectedFlowId, afterDelete);
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
    setStudioSelectedScenarioId(nextPinned);
    const selected = syncStudioScenarioSelection(afterDelete, nextPinned);
    if (selected) {
      setStudioScenarioLabel(selected.label);
      setStudioScenarioTags(selected.tags.join(", "));
      setStudioScenarioUseNodePins(selected.useNodePins);
      setStudioScenarioRegressionThresholds(selected.regressionThresholds);
      setUserMessage(selected.input);
      setStatus({ kind: "ok", message: "Cenário removido." });
    } else {
      setStudioScenarioLabel("");
      setStudioScenarioTags("");
      setStudioScenarioUseNodePins(false);
      setStudioScenarioRegressionThresholds({ ...defaultStudioRegressionThresholds });
      setStatus({ kind: "ok", message: "Cenário removido." });
    }
    if (!selected) {
      resetScenarioForm();
    }
  }

  function handleForkSelectedCheckpoint() {
    if (!selectedFlowId || !selectedStudioEvent) {
      setStatus({ kind: "error", message: "Selecione um evento da timeline para criar um fork." });
      return;
    }
    const now = new Date().toISOString();
    const nodeId = selectedStudioEvent.node ?? null;
    const input = inferCheckpointForkInput(selectedStudioEvent, transcript);
    const compatibility = buildStudioScenarioCheckpointCompatibility(
      draftFlow,
      nodeId,
      langGraphApprovalStatus,
      now,
    );
    const checkpoint: StudioScenarioCheckpoint = {
      sourceRunId: selectedStudioRunId || "run-atual",
      sourceSessionId: runtimeSession?.session_id ?? "",
      eventSeq: selectedStudioEvent.seq,
      eventType: selectedStudioEvent.event_type,
      nodeId,
      snapshotSeq: selectedStateSnapshot?.seq ?? null,
      status: typeof selectedStudioEvent.payload.status === "string" ? selectedStudioEvent.payload.status : selectedStateSnapshot?.status ?? null,
      phase: typeof selectedStudioEvent.payload.phase === "string" ? selectedStudioEvent.payload.phase : selectedStateSnapshot?.phase ?? null,
      turn: typeof selectedStudioEvent.payload.turn === "number" ? selectedStudioEvent.payload.turn : selectedStateSnapshot?.turn ?? null,
      state: selectedStateSnapshot?.state ?? null,
      input: inferEventInput(selectedStudioEvent, transcript),
      output: inferEventOutput(selectedStudioEvent.payload),
      createdAt: now,
      compatibility,
    };
    const label = `Fork ${nodeId ?? "runtime"} #${selectedStudioEvent.seq}`;
    const tags = splitTags(["fork", "checkpoint", nodeId ?? "runtime", `evento-${selectedStudioEvent.seq}`].join(", "));
    const scenario: StudioScenario = {
      id: `scenario-fork-${Date.now()}`,
      label,
      input,
      tags,
      isPinned: false,
      useNodePins: studioScenarioUseNodePins,
      regressionThresholds: studioScenarioRegressionThresholds,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      checkpoint,
    };
    const nextScenarios = sortScenarios([scenario, ...studioScenarios]);
    persistStudioScenarios(selectedFlowId, nextScenarios);
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
    setStudioSelectedScenarioId(scenario.id);
    setStudioScenarioLabel(label);
    setStudioScenarioTags(tags.join(", "));
    setStudioScenarioUseNodePins(scenario.useNodePins);
    setStudioScenarioRegressionThresholds(scenario.regressionThresholds);
    setUserMessage(input);
    setStatus({ kind: "ok", message: `Fork criado a partir do evento #${selectedStudioEvent.seq}.` });
  }

  function handlePinStudioNodeData(pinDraft: StudioNodePinDraft) {
    if (!selectedFlowId) {
      return;
    }
    const now = new Date().toISOString();
    const existing = studioNodePins.find((pin) => pin.nodeId === pinDraft.nodeId);
    const nextPin: StudioNodePin = {
      id: existing?.id ?? `node-pin-${pinDraft.nodeId}-${Date.now()}`,
      ...pinDraft,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const nextPins = [nextPin, ...studioNodePins.filter((pin) => pin.nodeId !== pinDraft.nodeId)];
    persistStudioNodePins(selectedFlowId, nextPins);
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
    setStatus({ kind: "ok", message: `Dados do nó ${pinDraft.nodeId} fixados para replay local.` });
  }

  function handleDeleteStudioNodePin(pinId: string) {
    if (!selectedFlowId) {
      return;
    }
    const nextPins = studioNodePins.filter((pin) => pin.id !== pinId);
    persistStudioNodePins(selectedFlowId, nextPins);
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
    setStatus({ kind: "ok", message: "Pin de nó removido." });
  }

  async function runStudioScenario(scenario: StudioScenario): Promise<StudioScenarioRunResult> {
    if (!selectedFlowId || !draftFlow) {
      throw new Error("Selecione um flow para executar cenário.");
    }
    const message = scenario.input.trim();
    if (!message) {
      throw new Error(`Cenário "${scenario.label}" não tem mensagem.`);
    }
    const restoreCompatibility = checkpointCompatibilityStatus(draftFlow, scenario.checkpoint, langGraphApprovalStatus);
    if (restoreCompatibility.level === "error") {
      throw new Error(
        `Cenário "${scenario.label}" não pode restaurar checkpoint: ${restoreCompatibility.reasons.join("; ")}`,
      );
    }
    const startedAt = Date.now();
    const runningSandbox = await ensureSandboxRunningForScenario();
    if (!runningSandbox.url) {
      throw new Error("URL do sandbox indisponível para execução do cenário.");
    }
    const resourceName = draftFlow.api.resourceName;
    const sandboxUrl = runningSandbox.url;
    const created = await createRuntimeSession(
      sandboxUrl,
      resourceName,
      studioScenarioExecutionMetadata(scenario, scenario.useNodePins ? activeStudioNodePins(studioNodePins, draftFlow) : []),
    );
    if (!created.session.session_id) {
      throw new Error("Sessão de execução não retornou ID.");
    }
    const createdSessionId = created.session.session_id;
    const started = await startRuntimeSession(sandboxUrl, resourceName, createdSessionId);
    if (!started.session.session_id) {
      throw new Error("Sessão de execução não iniciou corretamente.");
    }
    setRuntimeSession(started.session);
    setUserMessage(message);
    setTranscript(started.messages);
    const result = await sendRuntimeTurn(sandboxUrl, resourceName, createdSessionId, message);
    setRuntimeSession(result.session);
    const savedRun = await refreshRuntimeData(result.session);
    await refreshSandboxState(selectedFlowId, true);
    return {
      sessionId: result.session.session_id,
      runId: savedRun?.id ?? null,
      message: result.assistant_message.text || "Cenário executado.",
      durationMs: Date.now() - startedAt,
    };
  }

  function persistStudioScenarioUsage(scenarioIds: string[], lastUsedAt: string) {
    if (!selectedFlowId || scenarioIds.length === 0) {
      return;
    }
    const used = new Set(scenarioIds);
    const updated = studioScenarios.map((scenario) => ({
      ...scenario,
      lastUsedAt: used.has(scenario.id) ? lastUsedAt : scenario.lastUsedAt,
    }));
    persistStudioScenarios(selectedFlowId, updated);
  }

  async function handleRunStudioScenario() {
    const selected = syncStudioScenarioSelection(studioScenarios, studioSelectedScenarioId);
    if (!selected) {
      setStatus({ kind: "error", message: "Selecione um cenário para executar." });
      return;
    }
    setStatus({ kind: "busy", message: `Executando cenário "${selected.label}".` });
    try {
      const result = await runStudioScenario(selected);
      persistStudioScenarioUsage([selected.id], new Date().toISOString());
      setStudioSelectedScenarioId(selected.id);
      setStatus({ kind: "ok", message: result.message });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleRunStudioScenarioBatch() {
    const scenarios = studioScenarios.filter((scenario) => scenario.input.trim());
    if (scenarios.length === 0) {
      setStatus({ kind: "error", message: "Não há cenários com mensagem para executar em lote." });
      return;
    }
    const results: StudioScenarioBatchResult[] = [];
    const succeeded: string[] = [];
    let lastComparison: StudioRunComparison | null = null;
    setStudioScenarioBatchResults([]);
    setStudioScenarioBatchApproval(null);
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      setStatus({ kind: "busy", message: `Executando lote ${index + 1}/${scenarios.length}: ${scenario.label}.` });
      const baselineRunId = await findLatestScenarioRunId(scenario.id);
      try {
        const result = await runStudioScenario(scenario);
        const comparison = await compareScenarioBatchRun(scenario.id, baselineRunId, result.runId);
        if (comparison.fullComparison) {
          lastComparison = comparison.fullComparison;
        }
        succeeded.push(scenario.id);
        results.push({
          scenarioId: scenario.id,
          label: scenario.label,
          status: "ok",
          sessionId: result.sessionId,
          runId: result.runId,
          message: result.message,
          durationMs: result.durationMs,
          comparison: comparison.summary,
          completedAt: new Date().toISOString(),
        });
        setStudioSelectedScenarioId(scenario.id);
      } catch (error) {
        results.push({
          scenarioId: scenario.id,
          label: scenario.label,
          status: "error",
          sessionId: null,
          runId: null,
          message: errorMessage(error),
          durationMs: null,
          comparison: {
            baselineRunId,
            candidateRunId: null,
            severity: "error",
            verdict: "Execução falhou antes da comparação.",
            reasons: [errorMessage(error)],
          },
          completedAt: new Date().toISOString(),
        });
      }
      setStudioScenarioBatchResults([...results]);
    }
    persistStudioScenarioUsage(succeeded, new Date().toISOString());
    if (lastComparison) {
      setStudioRunComparison(lastComparison);
      setStudioRunCompareRunId(lastComparison.leftRunId);
      setSelectedStudioRunId(lastComparison.rightRunId);
    }
    const failedCount = results.filter((result) => result.status === "error").length;
    setStatus({
      kind: failedCount > 0 ? "error" : "ok",
      message: `Lote concluído: ${succeeded.length}/${results.length} cenário(s) executado(s).`,
    });
  }

  function currentStudioScenarioBatchReport(
    approval: StudioScenarioBatchApproval | null = studioScenarioBatchApproval,
  ): StudioScenarioBatchReport | null {
    if (!selectedFlowId || !draftFlow || studioScenarioBatchResults.length === 0) {
      return null;
    }
    return buildStudioScenarioBatchReport(selectedFlowId, draftFlow, studioScenarioBatchResults, approval);
  }

  function handleExportStudioScenarioBatchReport() {
    const report = currentStudioScenarioBatchReport();
    if (!report) {
      setStatus({ kind: "error", message: "Execute um lote de cenários antes de exportar relatório." });
      return;
    }
    const fileName = `studio-batch-report-${sanitizeFileNamePart(report.flow.id)}-${report.reportHash}.json`;
    downloadJsonFile(fileName, report);
    setStatus({ kind: "ok", message: `Relatório de lote exportado. Hash ${report.reportHash}.` });
  }

  function handleApproveStudioScenarioBatch() {
    const report = currentStudioScenarioBatchReport(null);
    if (!report) {
      setStatus({ kind: "error", message: "Execute um lote de cenários antes de aprovar." });
      return;
    }
    if (report.summary.errorCount > 0 || report.summary.comparisonErrorCount > 0 || report.summary.failCount > 0) {
      setStatus({
        kind: "error",
        message: "Lote não aprovado: resolva erros de execução, erros de comparação ou regressões com falha.",
      });
      return;
    }
    const approval: StudioScenarioBatchApproval = {
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: "local-user",
      reportHash: report.reportHash,
      summarySeverity: report.summary.severity,
      resultCount: report.summary.resultCount,
    };
    setStudioScenarioBatchApproval(approval);
    setStatus({ kind: "ok", message: `Lote aprovado localmente. Hash ${approval.reportHash}.` });
  }

  async function findLatestScenarioRunId(scenarioId: string): Promise<string | null> {
    if (!selectedFlowId) {
      return null;
    }
    try {
      const result = await listStudioRuns(selectedFlowId, {});
      for (const run of result.runs) {
        const record = await loadStudioRun(selectedFlowId, run.id);
        if (studioRunScenarioId(record) === scenarioId) {
          return record.id;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  async function compareScenarioBatchRun(
    scenarioId: string,
    baselineRunId: string | null,
    candidateRunId: string | null,
  ): Promise<{ summary: StudioScenarioBatchComparison; fullComparison: StudioRunComparison | null }> {
    if (!selectedFlowId || !candidateRunId) {
      return {
        summary: {
          baselineRunId,
          candidateRunId,
          severity: "error",
          verdict: "Run candidate não foi persistido.",
          reasons: ["Persistência local do run não retornou ID."],
        },
        fullComparison: null,
      };
    }
    if (!baselineRunId) {
      return {
        summary: {
          baselineRunId: null,
          candidateRunId,
          severity: "missing",
          verdict: "Sem baseline anterior para este cenário.",
          reasons: [`Primeira execução registrada para ${scenarioId}.`],
        },
        fullComparison: null,
      };
    }
    try {
      const comparison = await compareStudioRuns(selectedFlowId, baselineRunId, candidateRunId);
      return {
        summary: {
          baselineRunId,
          candidateRunId,
          severity: comparison.regression.severity,
          verdict: comparison.regression.verdict,
          reasons: comparison.regression.reasons,
        },
        fullComparison: comparison,
      };
    } catch (error) {
      return {
        summary: {
          baselineRunId,
          candidateRunId,
          severity: "error",
          verdict: "Falha ao comparar baseline e candidate.",
          reasons: [errorMessage(error)],
        },
        fullComparison: null,
      };
    }
  }

  function handleRunPinnedScenario() {
    const pinned = studioScenarios.find((scenario) => scenario.isPinned);
    if (!pinned) {
      setStatus({ kind: "error", message: "Não há cenário fixado para execução rápida." });
      return;
    }
    setStudioSelectedScenarioId(pinned.id);
    setStatus({ kind: "busy", message: `Executando cenário fixado "${pinned.label}".` });
    void runStudioScenario(pinned)
      .then((result) => {
        persistStudioScenarioUsage([pinned.id], new Date().toISOString());
        setStatus({ kind: "ok", message: result.message });
      })
      .catch((error: unknown) => {
        setStatus({ kind: "error", message: errorMessage(error) });
      });
  }

  async function handleCreateRuntimeSession() {
    if (!draftFlow || !sandbox?.url) {
      return;
    }
    setStatus({ kind: "busy", message: "Criando sessão no runtime." });
    try {
      const created = await createRuntimeSession(sandbox.url, draftFlow.api.resourceName);
      const started = await startRuntimeSession(sandbox.url, draftFlow.api.resourceName, created.session.session_id);
      setRuntimeSession(started.session);
      setTranscript(started.messages);
      await refreshRuntimeData(started.session);
      await refreshSandboxState(selectedFlowId, true);
      setStatus({ kind: "ok", message: `Sessão ${started.session.session_id} iniciada.` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleSendRuntimeTurn() {
    if (!draftFlow || !sandbox?.url || !runtimeSession || !userMessage.trim()) {
      return;
    }
    setStatus({ kind: "busy", message: "Enviando turno ao runtime." });
    try {
      const result = await sendRuntimeTurn(
        sandbox.url,
        draftFlow.api.resourceName,
        runtimeSession.session_id,
        userMessage.trim(),
      );
      setRuntimeSession(result.session);
      setUserMessage("");
      await refreshRuntimeData(result.session);
      await refreshSandboxState(selectedFlowId, true);
      setStatus({ kind: "ok", message: result.assistant_message.text });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleFinishRuntimeSession() {
    if (!draftFlow || !sandbox?.url || !runtimeSession) {
      return;
    }
    setStatus({ kind: "busy", message: "Finalizando sessão no runtime." });
    try {
      const result = await finishRuntimeSession(sandbox.url, draftFlow.api.resourceName, runtimeSession.session_id);
      setRuntimeSession(result.session);
      await refreshRuntimeData(result.session);
      await refreshSandboxState(selectedFlowId, true);
      setStatus({ kind: "ok", message: "Sessão finalizada." });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  const hasWorkspaceDirty = isDirty || promptDirty || schemaDirty;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (hasPrimaryModifier && key === "s") {
        event.preventDefault();
        void handleSaveWorkspace();
        return;
      }
      if (hasPrimaryModifier && event.key === "Enter") {
        event.preventDefault();
        void handleValidate();
        return;
      }
      if (!hasPrimaryModifier && event.key === "Escape" && !isEditableShortcutTarget(event.target)) {
        if (selectedNodeId || selectedEdgeId) {
          event.preventDefault();
          setSelectedNodeId("");
          setSelectedEdgeId("");
        }
        return;
      }
      if (!hasPrimaryModifier && key === "a" && !isEditableShortcutTarget(event.target)) {
        event.preventDefault();
        firstPaletteButtonRef.current?.focus();
        return;
      }
      if (!hasPrimaryModifier && key === "f" && !isEditableShortcutTarget(event.target)) {
        event.preventDefault();
        reactFlowRef.current?.fitView({ duration: 220, padding: 0.2 });
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [handleSaveWorkspace, handleValidate, selectedEdgeId, selectedNodeId]);

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Boxes size={20} aria-hidden="true" />
          </div>
          <div>
            <h1>Agent Flow Builder</h1>
            <span>{builderApiUrl()}</span>
          </div>
        </div>

        <div className="toolbar">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={handleImportFile}
          />
          <input
            ref={fixtureInputRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={handleImportStudioScenarioFixtureFile}
          />
          <label className="flow-select">
            <span>Flow</span>
            <select value={selectedFlowId} onChange={(event) => setSelectedFlowId(event.target.value)}>
              {flows.map((flow) => (
                <option value={flow.id} key={flow.id}>
                  {flow.name ?? flow.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          >
            {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
          </button>
          <button type="button" className="icon-button" onClick={() => refreshFlows()} title="Atualizar flows">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={handleCreateFlow} title="Criar flow" aria-label="Criar flow">
            <Plus size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleExportFlow}
            disabled={!selectedFlowId}
            title="Exportar workspace"
            aria-label="Exportar workspace"
          >
            <Download size={17} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={handleImportClick} title="Importar workspace" aria-label="Importar workspace">
            <Upload size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="command-button"
            onClick={handleValidate}
            disabled={!selectedFlowId}
            title="Validar flow (Ctrl+Enter)"
          >
            <CheckCircle2 size={17} aria-hidden="true" />
            Validar
          </button>
          <button
            type="button"
            className="command-button"
            onClick={handleSaveWorkspace}
            disabled={!selectedFlowId || !hasWorkspaceDirty}
            title="Salvar workspace (Ctrl+S)"
          >
            <FileJson size={17} aria-hidden="true" />
            {hasWorkspaceDirty ? "Salvar" : "Salvo"}
          </button>
          <button
            type="button"
            className="command-button"
            onClick={handleGenerateLangGraphSandbox}
            disabled={!selectedFlowId}
            title="Gerar pacote LangGraph para LangSmith"
          >
            <GitBranch size={17} aria-hidden="true" />
            LangGraph
          </button>
          <button
            type="button"
            className="command-button"
            onClick={handleApproveLangGraphSandbox}
            disabled={!selectedFlowId}
            title="Aprovar o sandbox testado no LangSmith"
          >
            <UserCheck size={17} aria-hidden="true" />
            Aprovar
          </button>
          <button
            type="button"
            className="command-button primary"
            onClick={handleGenerateApprovedRuntime}
            disabled={!selectedFlowId || !canGenerateApprovedRuntime}
            title={canGenerateApprovedRuntime ? "Gerar runtime FastAPI/Docker aprovado" : langGraphApprovalLabel}
          >
            <Terminal size={17} aria-hidden="true" />
            API Docker
          </button>
          <span className={langGraphApprovalClass} title={langGraphApprovalStatus?.reason}>
            {langGraphApprovalLabel}
          </span>
          <button type="button" className="command-button" onClick={handleStartSandbox} disabled={!selectedFlowId}>
            <Send size={17} aria-hidden="true" />
            Studio
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <section className="panel-section">
            <h2>Flows</h2>
            <div className="flow-list">
              {flows.map((flow) => (
                <button
                  type="button"
                  key={flow.id}
                  className={`flow-row ${flow.id === selectedFlowId ? "selected" : ""}`}
                  onClick={() => setSelectedFlowId(flow.id)}
                >
                  <FileJson size={17} aria-hidden="true" />
                  <span>
                    <strong>{flow.name ?? flow.id}</strong>
                    <small>{flow.valid ? flow.version : "inválido"}</small>
                  </span>
                  {!flow.valid ? <AlertCircle size={16} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <h2>Palette</h2>
            <div className="palette-grid">
              {palette.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    ref={index === 0 ? firstPaletteButtonRef : undefined}
                    type="button"
                    className="palette-item"
                    key={item.type}
                    title={index === 0 ? `${item.type} (A foca a paleta)` : item.type}
                    onClick={() => handleAddNode(item.type)}
                    disabled={!draftFlow}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel-section compact">
            <h2>Contrato</h2>
            <dl className="kv-list">
              <div>
                <dt>API</dt>
                <dd>{draftFlow?.api.contract ?? "-"}</dd>
              </div>
              <div>
                <dt>Recurso</dt>
                <dd>/{draftFlow?.api.resourceName ?? "-"}</dd>
              </div>
              <div>
                <dt>LLM</dt>
                <dd>{draftFlow ? `${draftFlow.llm.adapter} · ${draftFlow.llm.model}` : "-"}</dd>
              </div>
            </dl>
          </section>
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            fitView
            minZoom={0.35}
            maxZoom={1.5}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => {
              setSelectedNodeId("");
              setSelectedEdgeId("");
              if (inspectorTab === "sandbox") {
                setStudioTimelineNodeFilter("");
              }
            }}
            onConnect={handleConnect}
            onReconnect={handleReconnect}
            onNodesDelete={handleNodesDelete}
            onEdgesDelete={handleEdgesDelete}
            onNodeDragStop={handleNodeDragStop}
            onInit={(instance) => {
              reactFlowRef.current = instance;
            }}
            isValidConnection={isConnectionValid}
            nodesDraggable
            nodesConnectable
            edgesReconnectable
            elementsSelectable
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background gap={18} size={1} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>

        <aside className="right-panel">
          <div className="tabs" role="tablist" aria-label="Inspector">
            <button
              type="button"
              className={inspectorTab === "properties" ? "active" : ""}
              onClick={() => setInspectorTab("properties")}
            >
              Editar
            </button>
            <button
              type="button"
              className={inspectorTab === "files" ? "active" : ""}
              onClick={() => setInspectorTab("files")}
            >
              Arquivos
            </button>
            <button
              type="button"
              className={inspectorTab === "validation" ? "active" : ""}
              onClick={() => setInspectorTab("validation")}
            >
              Validação
            </button>
            <button type="button" className={inspectorTab === "json" ? "active" : ""} onClick={() => setInspectorTab("json")}>
              JSON
            </button>
            <button
              type="button"
              className={inspectorTab === "artifact" ? "active" : ""}
              onClick={() => setInspectorTab("artifact")}
            >
              Artefato
            </button>
            <button
              type="button"
              className={inspectorTab === "runtime" ? "active" : ""}
              onClick={() => setInspectorTab("runtime")}
            >
              Runtime
            </button>
            <button
              type="button"
              className={inspectorTab === "sandbox" ? "active" : ""}
              onClick={() => setInspectorTab("sandbox")}
            >
              Studio
            </button>
          </div>

          {inspectorTab === "properties" ? (
            selectedEdge ? (
              <EdgeInspector
                flow={draftFlow}
                edge={selectedEdge}
                edgeIndex={selectedEdgeIndex}
                onEdgeFieldChange={updateEdgeField}
                onEdgeEndpointChange={updateEdgeEndpoint}
                onDeleteEdge={handleDeleteEdge}
              />
            ) : (
              <NodeInspector
                flow={draftFlow}
                node={selectedNode}
                llmAdapters={llmAdapters}
                onFlowFieldChange={updateFlowField}
                onFlowLlmAdapterChange={updateFlowLlmAdapter}
                onFlowLlmFieldChange={updateFlowLlmField}
                onNodeFieldChange={updateNodeField}
                onNodeNumberFieldChange={updateNodeNumberField}
                onNodeLlmAdapterChange={updateNodeLlmAdapter}
                onNodeLlmFieldChange={updateNodeLlmField}
                onNodeIdChange={handleNodeIdChange}
                onNodeTypeChange={handleNodeTypeChange}
                onDeleteNode={handleDeleteNode}
              />
            )
          ) : inspectorTab === "files" ? (
            <AssetsPanel
              flow={draftFlow}
              selectedPromptId={selectedPromptId}
              selectedSchemaId={selectedSchemaId}
              promptContent={promptContent}
              schemaContent={schemaContent}
              promptDirty={promptDirty}
              schemaDirty={schemaDirty}
              onPromptSelect={setSelectedPromptId}
              onSchemaSelect={setSelectedSchemaId}
              onPromptChange={(value) => {
                setPromptContent(value);
                setPromptDirty(true);
                setFlowValidation(null);
                setStudioScenarioBatchResults([]);
                setStudioScenarioBatchApproval(null);
              }}
              onSchemaChange={(value) => {
                setSchemaContent(value);
                setSchemaDirty(true);
                setFlowValidation(null);
                setStudioScenarioBatchResults([]);
                setStudioScenarioBatchApproval(null);
              }}
              onPromptCreate={handleCreatePrompt}
              onPromptDelete={handleDeletePrompt}
              onPromptSave={handleSavePrompt}
              onSchemaCreate={handleCreateSchema}
              onSchemaDelete={handleDeleteSchema}
              onSchemaSave={handleSaveSchema}
            />
          ) : inspectorTab === "validation" ? (
            <ValidationPanel
              flow={draftFlow}
              validation={flowValidation}
              onValidate={handleValidate}
              onSelectDiagnostic={handleSelectDiagnostic}
            />
          ) : inspectorTab === "json" ? (
            <pre className="json-preview">{draftFlow ? JSON.stringify(draftFlow, null, 2) : "{}"}</pre>
          ) : inspectorTab === "artifact" ? (
            <GeneratedArtifactPanel
              listing={artifactListing}
              content={artifactContent}
              selectedPath={selectedArtifactPath}
              dockerStatus={dockerRuntimeStatusData}
              dockerOperation={dockerRuntimeOperation}
              dockerBusy={dockerRuntimeBusy}
              dockerRuntimeUrl={dockerRuntimeUrl}
              dockerApiPort={dockerApiPort}
              dockerPostgresPort={dockerPostgresPort}
              dockerRedisPort={dockerRedisPort}
              dockerHistory={dockerRuntimeHistoryData}
              dockerAutoRefresh={dockerAutoRefresh}
              onDockerRuntimeUrlChange={setDockerRuntimeUrl}
              onDockerApiPortChange={setDockerApiPort}
              onDockerPostgresPortChange={setDockerPostgresPort}
              onDockerRedisPortChange={setDockerRedisPort}
              onDockerAutoRefreshChange={setDockerAutoRefresh}
              onSelectFile={handleSelectArtifactFile}
              onRefresh={handleRefreshArtifact}
              onDownload={handleDownloadArtifact}
              onRefreshDocker={handleRefreshDockerRuntime}
              onConfigureDockerPorts={handleConfigureDockerPorts}
              onDockerAction={handleDockerRuntimeAction}
              onCancelDockerBuild={handleCancelDockerBuild}
              dockerHistoryFilterDraft={dockerHistoryFilterDraft}
              dockerHistoryFilterApplied={dockerHistoryFilterApplied}
              dockerHistoryFilterHasChanges={dockerHistoryFilterHasChanges}
              dockerHistoryOperationOptions={dockerHistoryOperationOptions}
              dockerHistoryStatusOptions={dockerHistoryStatusOptions}
              dockerProgressStatusOptions={dockerProgressStatusOptions}
              onDockerHistoryFilterDraftChange={setDockerHistoryFilterDraft}
              onDockerHistoryApply={applyDockerHistoryFilter}
              onDockerHistoryClear={clearDockerHistoryFilter}
            />
          ) : inspectorTab === "runtime" ? (
            <RuntimeManifestPanel
              loaded={runtimeManifest}
              validation={manifestValidation}
              generation={manifestGeneration}
              outDir={manifestOutDir}
              onOutDirChange={setManifestOutDir}
              onRefresh={() => refreshRuntimeManifest()}
              onValidate={handleValidateManifest}
              onGenerate={handleGenerateManifest}
            />
          ) : (
            <SandboxPanel
              flow={draftFlow}
              selectedPromptId={selectedPromptId}
              promptContent={promptContent}
              sandbox={sandbox}
              sandboxes={activeSandboxes}
              sandboxPort={sandboxPort}
              langGraphApprovalStatus={langGraphApprovalStatus}
              session={runtimeSession}
              transcript={transcript}
              events={runtimeEventsData}
              timelineEvents={studioTimelineEvents}
              timelineNodeFilter={studioTimelineNodeFilter}
              selectedEvent={selectedStudioEvent}
              selectedStateSnapshot={selectedStateSnapshot}
              stateSnapshots={studioStateSnapshots}
              studioRunCausalAnalysis={studioRunCausalContext}
              studioRuns={studioRuns}
              selectedRunId={selectedStudioRunId}
              selectedCompareRunId={studioRunCompareRunId}
              userMessage={userMessage}
              studioRunSearch={studioRunSearch}
              studioRunNodeFilter={studioRunNodeFilter}
              studioRunStatusFilter={studioRunStatusFilter}
              studioRunPhaseFilter={studioRunPhaseFilter}
              studioRunMinDurationMsFilter={studioRunMinDurationMsFilter}
              studioRunMaxDurationMsFilter={studioRunMaxDurationMsFilter}
              studioRunHasErrorsOnly={studioRunHasErrorsOnly}
              studioRunCompletionFilter={studioRunCompletionFilter}
              studioRunComparison={studioRunComparison}
              studioScenarios={studioScenarios}
              studioSelectedScenarioId={studioSelectedScenarioId}
              studioScenarioLabel={studioScenarioLabel}
              studioScenarioTags={studioScenarioTags}
              studioScenarioUseNodePins={studioScenarioUseNodePins}
              studioScenarioRegressionThresholds={studioScenarioRegressionThresholds}
              studioScenarioBatchResults={studioScenarioBatchResults}
              studioScenarioBatchApproval={studioScenarioBatchApproval}
              studioNodePins={studioNodePins}
              setSandboxPort={setSandboxPort}
              setUserMessage={setUserMessage}
              onStudioRunSearchChange={setStudioRunSearch}
              onStudioRunNodeFilterChange={setStudioRunNodeFilter}
              onStudioRunStatusFilterChange={setStudioRunStatusFilter}
              onStudioRunPhaseFilterChange={setStudioRunPhaseFilter}
              onStudioRunMinDurationMsFilterChange={setStudioRunMinDurationMsFilter}
              onStudioRunMaxDurationMsFilterChange={setStudioRunMaxDurationMsFilter}
              onStudioRunHasErrorsOnlyChange={setStudioRunHasErrorsOnly}
              onStudioRunCompletionFilterChange={setStudioRunCompletionFilter}
              onStudioRunCompareRunIdChange={setStudioRunCompareRunId}
              onExportComparison={handleExportStudioRunComparison}
              onClearComparison={handleClearStudioRunComparison}
              onSelectEvent={setSelectedStudioEventSeq}
              onTimelineNodeFilterChange={setStudioTimelineNodeFilter}
              onRefreshRuns={handleRefreshStudioRuns}
              onLoadRun={handleLoadStudioRun}
              onExportRun={handleExportStudioRun}
              onCompareRuns={handleCompareStudioRuns}
              onStudioScenarioSave={handleSaveStudioScenario}
              onStudioScenarioSelect={handleSelectStudioScenario}
              onStudioScenarioRun={handleRunStudioScenario}
              onStudioScenarioBatchRun={handleRunStudioScenarioBatch}
              onStudioPinnedScenarioRun={handleRunPinnedScenario}
              onStudioScenarioPin={toggleStudioScenarioPin}
              onStudioScenarioDelete={handleDeleteStudioScenario}
              onStudioScenarioFixtureExport={handleExportStudioScenarioFixture}
              onStudioScenarioFixtureImport={handleStudioScenarioFixtureImportClick}
              onStudioScenarioBatchReportExport={handleExportStudioScenarioBatchReport}
              onStudioScenarioBatchApprove={handleApproveStudioScenarioBatch}
              onStudioNodePin={handlePinStudioNodeData}
              onStudioNodePinDelete={handleDeleteStudioNodePin}
              onForkCheckpoint={handleForkSelectedCheckpoint}
              onStudioScenarioLabelChange={setStudioScenarioLabel}
              onStudioScenarioTagsChange={setStudioScenarioTags}
              onStudioScenarioUseNodePinsChange={setStudioScenarioUseNodePins}
              onStudioScenarioRegressionThresholdChange={handleStudioScenarioRegressionThresholdChange}
              onStartSandbox={handleStartSandbox}
              onStopSandbox={handleStopSandbox}
              onRefreshSandbox={handleRefreshSandbox}
              onCreateSession={handleCreateRuntimeSession}
              onSendTurn={handleSendRuntimeTurn}
              onFinishSession={handleFinishRuntimeSession}
            />
          )}
        </aside>
      </main>

      <footer
        className={`statusbar ${status.kind}`}
        data-state={status.kind}
        role={status.kind === "error" ? "alert" : "status"}
        aria-live={status.kind === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        aria-busy={status.kind === "busy"}
      >
        <Send size={16} aria-hidden="true" />
        <span>{status.message}</span>
      </footer>
    </div>
  );
}

function NodeInspector({
  flow,
  node,
  llmAdapters,
  onFlowFieldChange,
  onFlowLlmAdapterChange,
  onFlowLlmFieldChange,
  onNodeFieldChange,
  onNodeNumberFieldChange,
  onNodeLlmAdapterChange,
  onNodeLlmFieldChange,
  onNodeIdChange,
  onNodeTypeChange,
  onDeleteNode,
}: {
  flow: AgentFlow | null;
  node: FlowNode | null;
  llmAdapters: LlmAdapterCatalogItem[];
  onFlowFieldChange: <K extends keyof Pick<AgentFlow, "name" | "version">>(key: K, value: AgentFlow[K]) => void;
  onFlowLlmAdapterChange: (adapterId: string) => void;
  onFlowLlmFieldChange: (key: keyof AgentFlow["llm"], value: string) => void;
  onNodeFieldChange: (nodeId: string, key: keyof FlowNode, value: string) => void;
  onNodeNumberFieldChange: (nodeId: string, key: keyof FlowNode, value: string) => void;
  onNodeLlmAdapterChange: (nodeId: string, adapterId: string) => void;
  onNodeLlmFieldChange: (nodeId: string, key: "model", value: string) => void;
  onNodeIdChange: (currentId: string, nextValue: string) => void;
  onNodeTypeChange: (nodeId: string, type: string) => void;
  onDeleteNode: (nodeId: string) => void;
}) {
  if (!flow || !node) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhum nó selecionado.</span>
      </div>
    );
  }
  const adapterOptions = llmAdapterOptions(llmAdapters, flow.llm.adapter);
  const nodeAdapterOptions = llmAdapterOptions(llmAdapters, String(node.llm?.adapter ?? flow.llm.adapter));
  const isLlmNode = node.type === "llm_prompt" || node.type === "llm_structured";
  const isCodeNode = node.type === "code";
  const isHttpNode = node.type === "http_request";
  const isTransformNode = node.type === "transform_json";
  const isDatabaseQueryNode = node.type === "database_query";
  const isDatabaseSaveNode = node.type === "database_save";
  const isFileExtractNode = node.type === "file_extract";
  const isRagNode = node.type === "rag_retrieval";
  const isApprovalNode = node.type === "approval_gate";
  const isScoringNode = node.type === "scoring";
  const isAnalyticsNode = node.type === "analytics";
  return (
    <div className="inspector-body">
      <div className="edit-group">
        <label>
          <span>Nome do flow</span>
          <input value={flow.name} onChange={(event) => onFlowFieldChange("name", event.target.value)} />
        </label>
        <label>
          <span>Versão</span>
          <input value={flow.version} onChange={(event) => onFlowFieldChange("version", event.target.value)} />
        </label>
        <label>
          <span>Adapter LLM</span>
          <select value={flow.llm.adapter} onChange={(event) => onFlowLlmAdapterChange(event.target.value)}>
            {adapterOptions.map((adapter) => (
              <option value={adapter.id} key={adapter.id} disabled={adapter.status !== "supported"}>
                {adapter.label}
                {adapter.status !== "supported" ? " (planejado)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Modelo LLM</span>
          <input value={flow.llm.model} onChange={(event) => onFlowLlmFieldChange("model", event.target.value)} />
        </label>
        <label>
          <span>API key env</span>
          <input value={flow.llm.apiKeyEnv ?? ""} onChange={(event) => onFlowLlmFieldChange("apiKeyEnv", event.target.value)} />
        </label>
        <label>
          <span>Base URL env</span>
          <input value={flow.llm.baseUrlEnv ?? ""} onChange={(event) => onFlowLlmFieldChange("baseUrlEnv", event.target.value)} />
        </label>
        <label>
          <span>Mock env</span>
          <input value={flow.llm.mockEnv ?? ""} onChange={(event) => onFlowLlmFieldChange("mockEnv", event.target.value)} />
        </label>
      </div>
      <div className="node-title">
        <strong>{node.id}</strong>
        <span>{node.type}</span>
      </div>
      {node.id === "start" || node.id === "end" ? (
        <dl className="kv-list inspector-list">
          <Field label="Descrição" value={node.description} />
        </dl>
      ) : (
        <div className="edit-group">
          <label>
            <span>ID</span>
            <input value={node.id} onChange={(event) => onNodeIdChange(node.id, event.target.value)} />
          </label>
          <label>
            <span>Tipo</span>
            <select value={node.type} onChange={(event) => onNodeTypeChange(node.id, event.target.value)}>
              {nodeTypeOptions.map((option) => (
                <option value={option.type} key={option.type}>
                  {option.type}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Descrição</span>
            <textarea
              value={node.description ?? ""}
              onChange={(event) => onNodeFieldChange(node.id, "description", event.target.value)}
              rows={3}
            />
          </label>
          <label>
            <span>Prompt</span>
            <select value={node.promptId ?? ""} onChange={(event) => onNodeFieldChange(node.id, "promptId", event.target.value)}>
              <option value="">-</option>
              {flow.prompts.map((prompt) => (
                <option value={prompt.id} key={prompt.id}>
                  {prompt.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Schema</span>
            <select
              value={node.outputSchema ?? ""}
              onChange={(event) => onNodeFieldChange(node.id, "outputSchema", event.target.value)}
            >
              <option value="">-</option>
              {flow.schemas.map((schema) => (
                <option value={schema.id} key={schema.id}>
                  {schema.id}
                </option>
              ))}
            </select>
          </label>
          {isLlmNode ? (
            <>
              <label>
                <span>Adapter do nó</span>
                <select
                  value={String(node.llm?.adapter ?? flow.llm.adapter)}
                  onChange={(event) => onNodeLlmAdapterChange(node.id, event.target.value)}
                >
                  {nodeAdapterOptions.map((adapter) => (
                    <option value={adapter.id} key={adapter.id} disabled={adapter.status !== "supported"}>
                      {adapter.label}
                      {adapter.status !== "supported" ? " (planejado)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Modelo do nó</span>
                <input
                  value={String(node.llm?.model ?? flow.llm.model)}
                  onChange={(event) => onNodeLlmFieldChange(node.id, "model", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isCodeNode ? (
            <>
              <label>
                <span>Handler legado</span>
                <input value={node.handler ?? ""} onChange={(event) => onNodeFieldChange(node.id, "handler", event.target.value)} />
              </label>
              <label>
                <span>Linguagem</span>
                <select
                  value={node.codeLanguage ?? "python"}
                  onChange={(event) => onNodeFieldChange(node.id, "codeLanguage", event.target.value)}
                >
                  <option value="python">Python</option>
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                  <option value="external">Externa</option>
                </select>
              </label>
              <label>
                <span>Modo de execução</span>
                <select
                  value={node.codeExecution ?? "native"}
                  onChange={(event) => onNodeFieldChange(node.id, "codeExecution", event.target.value)}
                >
                  <option value="native">Runtime nativo</option>
                  <option value="inline">Inline</option>
                  <option value="file">Arquivo</option>
                  <option value="http">HTTP tool</option>
                  <option value="mcp">MCP tool</option>
                  <option value="sidecar">Sidecar</option>
                  <option value="runtime_adapter">Adapter futuro</option>
                </select>
              </label>
              <label>
                <span>Code path</span>
                <input
                  value={node.codePath ?? ""}
                  placeholder="code/generate_questions.py"
                  onChange={(event) => onNodeFieldChange(node.id, "codePath", event.target.value)}
                />
              </label>
              <label>
                <span>Entry point</span>
                <input
                  value={node.codeEntry ?? ""}
                  placeholder="run"
                  onChange={(event) => onNodeFieldChange(node.id, "codeEntry", event.target.value)}
                />
              </label>
              <label>
                <span>Input path</span>
                <input
                  value={node.inputPath ?? ""}
                  placeholder="state.content"
                  onChange={(event) => onNodeFieldChange(node.id, "inputPath", event.target.value)}
                />
              </label>
              <label>
                <span>Result path</span>
                <input
                  value={node.resultPath ?? ""}
                  placeholder={`custom.${node.id}`}
                  onChange={(event) => onNodeFieldChange(node.id, "resultPath", event.target.value)}
                />
              </label>
              <label>
                <span>Dependências</span>
                <textarea
                  value={node.codeDependencies ?? ""}
                  placeholder={`requests==2.32.0\nbeautifulsoup4`}
                  onChange={(event) => onNodeFieldChange(node.id, "codeDependencies", event.target.value)}
                  rows={3}
                />
              </label>
              <label>
                <span>Código inline</span>
                <textarea
                  value={node.codeInline ?? ""}
                  placeholder={`def run(input, context):\n    return {"ok": True}`}
                  onChange={(event) => onNodeFieldChange(node.id, "codeInline", event.target.value)}
                  rows={8}
                  spellCheck={false}
                />
              </label>
            </>
          ) : null}
          {isHttpNode ? (
            <>
              <label>
                <span>Método</span>
                <select value={node.method ?? "GET"} onChange={(event) => onNodeFieldChange(node.id, "method", event.target.value)}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </label>
              <label>
                <span>URL</span>
                <input value={node.url ?? ""} onChange={(event) => onNodeFieldChange(node.id, "url", event.target.value)} />
              </label>
              <label>
                <span>Body path</span>
                <input value={node.bodyPath ?? ""} onChange={(event) => onNodeFieldChange(node.id, "bodyPath", event.target.value)} />
              </label>
              <label>
                <span>Response path</span>
                <input
                  value={node.responsePath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "responsePath", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isTransformNode ? (
            <>
              <label>
                <span>Input path</span>
                <input value={node.inputPath ?? ""} onChange={(event) => onNodeFieldChange(node.id, "inputPath", event.target.value)} />
              </label>
              <label>
                <span>Output path</span>
                <input
                  value={node.outputPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "outputPath", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isDatabaseQueryNode ? (
            <>
              <label>
                <span>Query SQL</span>
                <textarea value={node.query ?? ""} onChange={(event) => onNodeFieldChange(node.id, "query", event.target.value)} rows={4} />
              </label>
              <label>
                <span>Params path</span>
                <input
                  value={node.paramsPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "paramsPath", event.target.value)}
                />
              </label>
              <label>
                <span>Result path</span>
                <input
                  value={node.resultPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "resultPath", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isDatabaseSaveNode ? (
            <>
              <label>
                <span>Tabela</span>
                <input value={node.table ?? ""} onChange={(event) => onNodeFieldChange(node.id, "table", event.target.value)} />
              </label>
              <label>
                <span>Data path</span>
                <input value={node.dataPath ?? ""} onChange={(event) => onNodeFieldChange(node.id, "dataPath", event.target.value)} />
              </label>
              <label>
                <span>Result path</span>
                <input
                  value={node.resultPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "resultPath", event.target.value)}
                />
              </label>
              <label>
                <span>SQL opcional</span>
                <textarea value={node.query ?? ""} onChange={(event) => onNodeFieldChange(node.id, "query", event.target.value)} rows={3} />
              </label>
            </>
          ) : null}
          {isFileExtractNode ? (
            <>
              <label>
                <span>Source path</span>
                <input
                  value={node.sourcePath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "sourcePath", event.target.value)}
                />
              </label>
              <label>
                <span>Content path</span>
                <input
                  value={node.contentPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "contentPath", event.target.value)}
                />
              </label>
              <label>
                <span>Max chars</span>
                <input
                  type="number"
                  min={1}
                  value={node.maxChars ?? ""}
                  onChange={(event) => onNodeNumberFieldChange(node.id, "maxChars", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isRagNode ? (
            <>
              <label>
                <span>Collection path</span>
                <input
                  value={node.collectionPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "collectionPath", event.target.value)}
                />
              </label>
              <label>
                <span>Query path</span>
                <input value={node.queryPath ?? ""} onChange={(event) => onNodeFieldChange(node.id, "queryPath", event.target.value)} />
              </label>
              <label>
                <span>Context path</span>
                <input
                  value={node.contextPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "contextPath", event.target.value)}
                />
              </label>
              <label>
                <span>Top K</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={node.topK ?? ""}
                  onChange={(event) => onNodeNumberFieldChange(node.id, "topK", event.target.value)}
                />
              </label>
              <label>
                <span>Chunk size</span>
                <input
                  type="number"
                  min={1}
                  value={node.chunkSize ?? ""}
                  onChange={(event) => onNodeNumberFieldChange(node.id, "chunkSize", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isApprovalNode ? (
            <>
              <label>
                <span>Decision path</span>
                <input
                  value={node.decisionPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "decisionPath", event.target.value)}
                />
              </label>
              <label>
                <span>Approval value</span>
                <input
                  value={node.approvalValue ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "approvalValue", event.target.value)}
                />
              </label>
              <label>
                <span>Rejection value</span>
                <input
                  value={node.rejectionValue ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "rejectionValue", event.target.value)}
                />
              </label>
              <label>
                <span>Result path</span>
                <input
                  value={node.resultPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "resultPath", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isScoringNode ? (
            <>
              <label>
                <span>Input path</span>
                <input value={node.inputPath ?? ""} onChange={(event) => onNodeFieldChange(node.id, "inputPath", event.target.value)} />
              </label>
              <label>
                <span>Result path</span>
                <input
                  value={node.resultPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "resultPath", event.target.value)}
                />
              </label>
              <label>
                <span>Threshold</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={node.threshold ?? ""}
                  onChange={(event) => onNodeNumberFieldChange(node.id, "threshold", event.target.value)}
                />
              </label>
            </>
          ) : null}
          {isAnalyticsNode ? (
            <>
              <label>
                <span>Metric name</span>
                <input value={node.metricName ?? ""} onChange={(event) => onNodeFieldChange(node.id, "metricName", event.target.value)} />
              </label>
              <label>
                <span>Payload path</span>
                <input
                  value={node.payloadPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "payloadPath", event.target.value)}
                />
              </label>
              <label>
                <span>Result path</span>
                <input
                  value={node.resultPath ?? ""}
                  onChange={(event) => onNodeFieldChange(node.id, "resultPath", event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label>
            <span>Stage</span>
            <select value={node.stage ?? ""} onChange={(event) => onNodeFieldChange(node.id, "stage", event.target.value)}>
              <option value="">-</option>
              <option value="input">input</option>
              <option value="output">output</option>
              <option value="context">context</option>
            </select>
          </label>
          <button type="button" className="command-button danger full-width" onClick={() => onDeleteNode(node.id)}>
            Remover nó
          </button>
        </div>
      )}
      {node.promptId ? (
        <div className="reference-box">
          <strong>{node.promptId}</strong>
          <span>{flow.prompts.find((prompt) => prompt.id === node.promptId)?.path ?? "prompt não encontrado"}</span>
        </div>
      ) : null}
      {node.llm ? <pre className="mini-json">{JSON.stringify(node.llm, null, 2)}</pre> : null}
    </div>
  );
}

function EdgeInspector({
  flow,
  edge,
  edgeIndex,
  onEdgeFieldChange,
  onEdgeEndpointChange,
  onDeleteEdge,
}: {
  flow: AgentFlow | null;
  edge: FlowEdge;
  edgeIndex: number;
  onEdgeFieldChange: (edgeIndex: number, key: keyof FlowEdge, value: string) => void;
  onEdgeEndpointChange: (edgeIndex: number, key: "from" | "to", value: string) => void;
  onDeleteEdge: (edgeIndex: number) => void;
}) {
  if (!flow) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhuma aresta selecionada.</span>
      </div>
    );
  }
  const endpoints = ["start", ...flow.nodes.map((node) => node.id), "end"];
  return (
    <div className="inspector-body">
      <div className="node-title">
        <strong>
          {edge.from} {"->"} {edge.to}
        </strong>
        <span>aresta</span>
      </div>
      <div className="edit-group">
        <label>
          <span>Origem</span>
          <select value={edge.from} onChange={(event) => onEdgeEndpointChange(edgeIndex, "from", event.target.value)}>
            {endpoints.map((endpoint) => (
              <option value={endpoint} key={endpoint}>
                {endpoint}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Destino</span>
          <select value={edge.to} onChange={(event) => onEdgeEndpointChange(edgeIndex, "to", event.target.value)}>
            {endpoints.map((endpoint) => (
              <option value={endpoint} key={endpoint}>
                {endpoint}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Condição</span>
          <input
            value={edge.condition ?? ""}
            onChange={(event) => onEdgeFieldChange(edgeIndex, "condition", event.target.value)}
          />
        </label>
        <button type="button" className="command-button danger full-width" onClick={() => onDeleteEdge(edgeIndex)}>
          Remover aresta
        </button>
      </div>
    </div>
  );
}

function AssetsPanel({
  flow,
  selectedPromptId,
  selectedSchemaId,
  promptContent,
  schemaContent,
  promptDirty,
  schemaDirty,
  onPromptSelect,
  onSchemaSelect,
  onPromptChange,
  onSchemaChange,
  onPromptCreate,
  onPromptDelete,
  onPromptSave,
  onSchemaCreate,
  onSchemaDelete,
  onSchemaSave,
}: {
  flow: AgentFlow | null;
  selectedPromptId: string;
  selectedSchemaId: string;
  promptContent: string;
  schemaContent: string;
  promptDirty: boolean;
  schemaDirty: boolean;
  onPromptSelect: (value: string) => void;
  onSchemaSelect: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSchemaChange: (value: string) => void;
  onPromptCreate: (value: string) => void;
  onPromptDelete: () => void;
  onPromptSave: () => void;
  onSchemaCreate: (value: string) => void;
  onSchemaDelete: () => void;
  onSchemaSave: () => void;
}) {
  const [newPromptId, setNewPromptId] = useState("");
  const [newSchemaId, setNewSchemaId] = useState("");
  const selectedPrompt = flow?.prompts.find((prompt) => prompt.id === selectedPromptId) ?? null;
  const selectedSchema = flow?.schemas.find((schema) => schema.id === selectedSchemaId) ?? null;
  if (!flow) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhum flow carregado.</span>
      </div>
    );
  }
  return (
    <div className="assets-body">
      <section className="asset-section">
        <div className="sandbox-header">
          <strong>Prompt</strong>
          <span>{promptDirty ? "alterado" : "salvo"}</span>
        </div>
        <div className="asset-create">
          <input value={newPromptId} onChange={(event) => setNewPromptId(event.target.value)} placeholder="novo_prompt" />
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              onPromptCreate(newPromptId);
              setNewPromptId("");
            }}
            disabled={!newPromptId.trim()}
            title="Criar prompt"
            aria-label="Criar prompt"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onPromptDelete}
            disabled={!selectedPromptId}
            title="Remover prompt"
            aria-label="Remover prompt"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
        <select className="asset-select" value={selectedPromptId} onChange={(event) => onPromptSelect(event.target.value)}>
          {flow.prompts.map((prompt) => (
            <option value={prompt.id} key={prompt.id}>
              {prompt.id}
            </option>
          ))}
        </select>
        {selectedPrompt ? <small className="asset-path">{selectedPrompt.path}</small> : null}
        <textarea
          className="asset-editor prompt-editor"
          value={promptContent}
          onChange={(event) => onPromptChange(event.target.value)}
          spellCheck={false}
        />
        <button type="button" className="command-button primary full-width" onClick={onPromptSave} disabled={!selectedPromptId || !promptDirty}>
          Salvar prompt
        </button>
      </section>

      <section className="asset-section">
        <div className="sandbox-header">
          <strong>Schema</strong>
          <span>{schemaDirty ? "alterado" : "salvo"}</span>
        </div>
        <div className="asset-create">
          <input value={newSchemaId} onChange={(event) => setNewSchemaId(event.target.value)} placeholder="novo_schema" />
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              onSchemaCreate(newSchemaId);
              setNewSchemaId("");
            }}
            disabled={!newSchemaId.trim()}
            title="Criar schema"
            aria-label="Criar schema"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onSchemaDelete}
            disabled={!selectedSchemaId}
            title="Remover schema"
            aria-label="Remover schema"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
        <select className="asset-select" value={selectedSchemaId} onChange={(event) => onSchemaSelect(event.target.value)}>
          {flow.schemas.map((schema) => (
            <option value={schema.id} key={schema.id}>
              {schema.id}
            </option>
          ))}
        </select>
        {selectedSchema ? <small className="asset-path">{selectedSchema.path}</small> : null}
        <textarea
          className="asset-editor schema-editor"
          value={schemaContent}
          onChange={(event) => onSchemaChange(event.target.value)}
          spellCheck={false}
        />
        <button type="button" className="command-button primary full-width" onClick={onSchemaSave} disabled={!selectedSchemaId || !schemaDirty}>
          Salvar schema
        </button>
      </section>
    </div>
  );
}

function ValidationPanel({
  flow,
  validation,
  onValidate,
  onSelectDiagnostic,
}: {
  flow: AgentFlow | null;
  validation: ValidationResult | null;
  onValidate: () => void;
  onSelectDiagnostic: (diagnostic: FlowDiagnostic) => void;
}) {
  if (!flow) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhum flow carregado.</span>
      </div>
    );
  }

  const diagnostics = validation?.diagnostics ?? [];
  return (
    <div className="runtime-manifest-body">
      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>{flow.name}</strong>
          <span className={validation?.status === "error" ? "runtime-pill error" : "runtime-pill running"}>
            {validation?.status ?? "pendente"}
          </span>
        </div>
        <dl className="kv-list inspector-list">
          <Field label="Flow" value={flow.id} />
          <Field label="Nós" value={String(validation?.summary.nodes ?? flow.nodes.length)} />
          <Field label="Arestas" value={String(validation?.summary.edges ?? flow.edges.length)} />
          <Field label="Prompts" value={String(validation?.summary.prompts ?? flow.prompts.length)} />
          <Field label="Schemas" value={String(validation?.summary.schemas ?? flow.schemas.length)} />
        </dl>
        <button type="button" className="command-button primary full-width" onClick={onValidate}>
          <CheckCircle2 size={16} aria-hidden="true" />
          Validar flow
        </button>
      </section>

      {validation ? (
        <section className="sandbox-section">
          <div className="sandbox-header">
            <strong>Diagnósticos</strong>
            <span>
              {validation.summary.errors} erro(s), {validation.summary.warnings} aviso(s)
            </span>
          </div>
          {diagnostics.length ? (
            <div className="diagnostic-list">
              {diagnostics.map((diagnostic, index) => (
                <button
                  type="button"
                  className={`diagnostic-item ${diagnostic.severity}`}
                  key={`${diagnostic.code}-${index}`}
                  onClick={() => onSelectDiagnostic(diagnostic)}
                >
                  <strong>
                    {diagnostic.severity} · {diagnostic.code}
                  </strong>
                  <span>{diagnostic.message}</span>
                  {diagnostic.path ? <small>{diagnostic.path}</small> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="runtime-item">
              <strong>Nenhum diagnóstico</strong>
              <span>O flow passou nas validações estruturais e de assets.</span>
            </div>
          )}
        </section>
      ) : (
        <section className="sandbox-section">
          <div className="runtime-item">
            <strong>Validação pendente</strong>
            <span>Sem resultado de validação para este flow.</span>
          </div>
        </section>
      )}
    </div>
  );
}

function GeneratedArtifactPanel({
  listing,
  content,
  selectedPath,
  dockerStatus,
  dockerOperation,
  dockerBusy,
  dockerRuntimeUrl,
  dockerApiPort,
  dockerPostgresPort,
  dockerRedisPort,
  dockerHistory,
  dockerAutoRefresh,
  onDockerRuntimeUrlChange,
  onDockerApiPortChange,
  onDockerPostgresPortChange,
  onDockerRedisPortChange,
  onDockerAutoRefreshChange,
  onSelectFile,
  onRefresh,
  onDownload,
  onRefreshDocker,
  onConfigureDockerPorts,
  onDockerAction,
  onCancelDockerBuild,
  dockerHistoryFilterDraft,
  dockerHistoryFilterApplied,
  dockerHistoryFilterHasChanges,
  dockerHistoryOperationOptions,
  dockerHistoryStatusOptions,
  dockerProgressStatusOptions,
  onDockerHistoryFilterDraftChange,
  onDockerHistoryApply,
  onDockerHistoryClear,
}: {
  listing: GeneratedArtifactListing | null;
  content: GeneratedArtifactFileContent | null;
  selectedPath: string;
  dockerStatus: DockerRuntimeStatus | null;
  dockerOperation: DockerRuntimeOperationResult | null;
  dockerBusy: DockerRuntimeOperation | "refresh" | null;
  dockerRuntimeUrl: string;
  dockerApiPort: string;
  dockerPostgresPort: string;
  dockerRedisPort: string;
  dockerHistory: DockerRuntimeHistory | null;
  dockerAutoRefresh: boolean;
  onDockerRuntimeUrlChange: (value: string) => void;
  onDockerApiPortChange: (value: string) => void;
  onDockerPostgresPortChange: (value: string) => void;
  onDockerRedisPortChange: (value: string) => void;
  onDockerAutoRefreshChange: (value: boolean) => void;
  onSelectFile: (path: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
  onRefreshDocker: () => void;
  onConfigureDockerPorts: () => void;
  onDockerAction: (operation: DockerRuntimeOperation) => void;
  onCancelDockerBuild: () => void;
  dockerHistoryFilterDraft: DockerHistoryFilterForm;
  dockerHistoryFilterApplied: DockerHistoryFilterForm;
  dockerHistoryFilterHasChanges: boolean;
  dockerHistoryOperationOptions: readonly DockerRuntimeOperation[];
  dockerHistoryStatusOptions: readonly DockerRuntimeOperationStatus[];
  dockerProgressStatusOptions: readonly DockerRuntimeProgressStatus[];
  onDockerHistoryFilterDraftChange: (next: DockerHistoryFilterForm) => void;
  onDockerHistoryApply: () => Promise<void>;
  onDockerHistoryClear: () => void;
}) {
  const rawBuildProgress = useMemo(() => {
    if (dockerOperation?.operation === "build" && dockerOperation.progress?.length) {
      return dockerOperation.progress;
    }
    const buildEntries = dockerHistory?.entries ?? [];
    const latestBuild = buildEntries.find((entry) => entry.operation === "build" && (entry.progress?.length ?? 0) > 0);
    return latestBuild?.progress ?? [];
  }, [dockerHistory, dockerOperation]);
  const buildProgress = useMemo(
    () => rawBuildProgress.filter((step) => dockerProgressMatchesFilter(step, dockerHistoryFilterApplied)),
    [dockerHistoryFilterApplied, rawBuildProgress],
  );

  if (!listing) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhum artefato gerado carregado.</span>
      </div>
    );
  }

  return (
    <div className="runtime-manifest-body">
      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Artefato gerado</strong>
          <span className="runtime-pill running">{listing.files.length}</span>
        </div>
        <dl className="kv-list inspector-list">
          <Field label="Diretório" value={listing.outDir} />
          <Field label="Tamanho" value={formatBytes(listing.totalSizeBytes)} />
        </dl>
        <div className="sandbox-actions">
          <button type="button" className="command-button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </button>
          <button type="button" className="command-button primary" onClick={onDownload}>
            <Download size={16} aria-hidden="true" />
            Baixar zip
          </button>
        </div>
      </section>

      {artifactLooksLikeDockerRuntime(listing) ? (
        <section className="sandbox-section">
          <div className="sandbox-header">
            <strong>API Docker final</strong>
            <span className={`runtime-pill ${dockerRuntimePillClass(dockerStatus)}`}>
              {dockerRuntimeStatusLabel(dockerStatus, dockerBusy)}
            </span>
          </div>
          <dl className="kv-list inspector-list">
            <Field label="Recurso" value={dockerStatus?.resourceName ?? "-"} />
            <Field label="Flow" value={dockerStatus?.flowId ?? "-"} />
            <Field label="Env local" value={dockerStatus?.envFile ? ".env encontrado" : "copie .env.example para .env antes de subir"} />
          </dl>
          <label className="docker-runtime-url">
            <span>Runtime URL</span>
            <input
              value={dockerRuntimeUrl}
              onChange={(event) => onDockerRuntimeUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:8080"
            />
          </label>
          <div className="docker-port-grid">
            <label>
              <span>API</span>
              <input
                inputMode="numeric"
                value={dockerApiPort}
                onChange={(event) => onDockerApiPortChange(event.target.value)}
                placeholder="8080"
              />
            </label>
            <label>
              <span>Postgres</span>
              <input
                inputMode="numeric"
                value={dockerPostgresPort}
                onChange={(event) => onDockerPostgresPortChange(event.target.value)}
                placeholder="5433"
              />
            </label>
            <label>
              <span>Redis</span>
              <input
                inputMode="numeric"
                value={dockerRedisPort}
                onChange={(event) => onDockerRedisPortChange(event.target.value)}
                placeholder="6380"
              />
            </label>
          </div>
          <button
            type="button"
            className="command-button full-width"
            onClick={onConfigureDockerPorts}
            disabled={dockerBusy !== null}
          >
            <Terminal size={16} aria-hidden="true" />
            Aplicar portas no compose
          </button>
          <label className="docker-auto-refresh">
            <input
              type="checkbox"
              checked={dockerAutoRefresh}
              onChange={(event) => onDockerAutoRefreshChange(event.target.checked)}
            />
            <span>Auto-atualizar status e logs</span>
          </label>
          <div className="sandbox-actions">
            <button
              type="button"
              className="command-button"
              onClick={onRefreshDocker}
              disabled={dockerBusy !== null}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Status
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => onDockerAction("inspect")}
              disabled={dockerBusy !== null}
            >
              <Search size={16} aria-hidden="true" />
              Inspecionar
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => onDockerAction("prepare_env")}
              disabled={dockerBusy !== null}
            >
              <FileText size={16} aria-hidden="true" />
              Preparar .env
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => onDockerAction("build")}
              disabled={dockerBusy !== null}
            >
              <Terminal size={16} aria-hidden="true" />
              Build
            </button>
            <button
              type="button"
              className="command-button danger"
              onClick={onCancelDockerBuild}
              disabled={dockerBusy !== "build"}
              title="Cancelar build Docker em andamento"
            >
              <Square size={16} aria-hidden="true" />
              Cancelar
            </button>
            <button
              type="button"
              className="command-button primary"
              onClick={() => onDockerAction("up")}
              disabled={dockerBusy !== null}
            >
              <Play size={16} aria-hidden="true" />
              Up
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => onDockerAction("smoke")}
              disabled={dockerBusy !== null}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              Smoke
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => onDockerAction("down")}
              disabled={dockerBusy !== null}
            >
              <CircleDot size={16} aria-hidden="true" />
              Down
            </button>
          </div>
          {dockerStatus ? (
            <div className="artifact-runtime-links">
              <a href={dockerStatus.docsUrl} target="_blank" rel="noreferrer">
                Docs
              </a>
              <a href={dockerStatus.openapiUrl} target="_blank" rel="noreferrer">
                OpenAPI
              </a>
            </div>
          ) : null}
          {dockerOperation?.smoke ? (
            <div className="runtime-item">
              <strong>Smoke test</strong>
              <span>
                Sessão {dockerOperation.smoke.sessionId}; transcript {dockerOperation.smoke.transcriptCount}; eventos{" "}
                {dockerOperation.smoke.eventsCount}.
              </span>
            </div>
          ) : null}
          {dockerStatus?.inspection?.containers.length ? (
            <div className="docker-service-list">
              {dockerStatus.inspection.containers.map((service, index) => (
                <div className="docker-service-row" key={`${service.name ?? service.service ?? "service"}-${index}`}>
                  <strong>{service.service ?? service.name ?? "service"}</strong>
                  <span>{service.state ?? service.status ?? "-"}</span>
                  <small>{service.ports ?? "-"}</small>
                </div>
              ))}
            </div>
          ) : null}
          {dockerStatus?.logs.length ? (
            <pre className="mini-json artifact-preview">{dockerStatus.logs.join("\n")}</pre>
          ) : null}
          {rawBuildProgress.length ? (
            <div className="docker-progress">
              <strong>
                Progresso do build
                {buildProgress.length !== rawBuildProgress.length ? ` (${buildProgress.length}/${rawBuildProgress.length})` : ""}
              </strong>
              {buildProgress.length ? (
                <div className="docker-progress-list">
                  {buildProgress.map((step) => (
                    <div className="docker-progress-row" key={`${step.timestamp}-${step.line}`}>
                      <div className="docker-progress-header">
                        <strong>{step.stage}</strong>
                        <span className={`docker-progress-status ${dockerProgressClass(step.status)}`}>{step.status}</span>
                      </div>
                      <p>{step.message}</p>
                      {typeof step.percent === "number" ? (
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${step.percent}%` }} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="docker-progress-empty">Nenhuma etapa do build corresponde aos filtros aplicados.</p>
              )}
            </div>
          ) : null}
          <div className="docker-history-toolbar">
            <label className="docker-history-filter-input">
              <span>Operação</span>
              <select
                value={dockerHistoryFilterDraft.operation}
                onChange={(event) =>
                  onDockerHistoryFilterDraftChange({
                    ...dockerHistoryFilterDraft,
                    operation: event.target.value as DockerRuntimeOperation | "",
                  })
                }
              >
                <option value="">Todas</option>
                {dockerHistoryOperationOptions.map((operation) => (
                  <option value={operation} key={`docker-history-operation-${operation}`}>
                    {operation}
                  </option>
                ))}
              </select>
            </label>
            <label className="docker-history-filter-input">
              <span>Status</span>
              <select
                value={dockerHistoryFilterDraft.status}
                onChange={(event) =>
                  onDockerHistoryFilterDraftChange({
                    ...dockerHistoryFilterDraft,
                    status: event.target.value as DockerRuntimeOperationStatus | "",
                  })
                }
              >
                <option value="">Todos</option>
                {dockerHistoryStatusOptions.map((status) => (
                  <option value={status} key={`docker-history-status-${status}`}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="docker-history-filter-input">
              <span>Resultado</span>
              <select
                value={dockerHistoryFilterDraft.ok}
                onChange={(event) =>
                  onDockerHistoryFilterDraftChange({ ...dockerHistoryFilterDraft, ok: event.target.value as "" | "true" | "false" })
                }
              >
                <option value="">Todos</option>
                <option value="true">ok</option>
                <option value="false">erro</option>
              </select>
            </label>
            <label className="docker-history-filter-input">
              <span>Busca</span>
              <input
                value={dockerHistoryFilterDraft.search}
                onChange={(event) => onDockerHistoryFilterDraftChange({ ...dockerHistoryFilterDraft, search: event.target.value })}
                placeholder="operacao, status ou texto"
              />
            </label>
            <label className="docker-history-filter-input">
              <span>Etapa</span>
              <input
                value={dockerHistoryFilterDraft.progressStage}
                onChange={(event) =>
                  onDockerHistoryFilterDraftChange({ ...dockerHistoryFilterDraft, progressStage: event.target.value })
                }
                placeholder="metadata, copy, install"
              />
            </label>
            <label className="docker-history-filter-input">
              <span>Progresso</span>
              <select
                value={dockerHistoryFilterDraft.progressStatus}
                onChange={(event) =>
                  onDockerHistoryFilterDraftChange({
                    ...dockerHistoryFilterDraft,
                    progressStatus: event.target.value as DockerRuntimeProgressStatus | "",
                  })
                }
              >
                <option value="">Todos</option>
                {dockerProgressStatusOptions.map((status) => (
                  <option value={status} key={`docker-progress-status-${status}`}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="docker-history-filter-input">
              <span>De</span>
              <input
                type="datetime-local"
                step="1"
                value={dockerHistoryFilterDraft.from}
                onChange={(event) => onDockerHistoryFilterDraftChange({ ...dockerHistoryFilterDraft, from: event.target.value })}
                placeholder="2026-01-01T00:00:00"
              />
            </label>
            <label className="docker-history-filter-input">
              <span>Até</span>
              <input
                type="datetime-local"
                step="1"
                value={dockerHistoryFilterDraft.to}
                onChange={(event) => onDockerHistoryFilterDraftChange({ ...dockerHistoryFilterDraft, to: event.target.value })}
                placeholder="2026-01-01T23:59:59"
              />
            </label>
            <label className="docker-history-filter-input">
              <span>Limite</span>
              <input
                type="number"
                min={1}
                max={100}
                value={dockerHistoryFilterDraft.limit}
                onChange={(event) => onDockerHistoryFilterDraftChange({ ...dockerHistoryFilterDraft, limit: event.target.value })}
              />
            </label>
            <div className="timeline-toolbar">
              <button
                type="button"
                className="command-button"
                onClick={onDockerHistoryApply}
                disabled={!dockerHistoryFilterHasChanges}
              >
                Aplicar
              </button>
              <button type="button" className="command-button" onClick={onDockerHistoryClear}>
                Limpar
              </button>
            </div>
          </div>
          {dockerHistory?.entries.length ? (
            <div className="docker-history-list">
              {dockerHistory.entries.slice(0, 8).map((entry) => (
                <div className="docker-history-row" key={entry.id}>
                  <strong>{dockerOperationName(entry.operation)}</strong>
                  <span className={entry.ok ? "history-ok" : "history-error"}>{entry.ok ? "ok" : "erro"}</span>
                  <small>{formatDateTime(entry.finishedAt)}</small>
                  <p>{entry.message}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Arquivos</strong>
          <span>{formatBytes(listing.totalSizeBytes)}</span>
        </div>
        <div className="artifact-file-list">
          {listing.files.map((file) => (
            <button
              type="button"
              className={`artifact-file-button ${file.path === selectedPath ? "selected" : ""}`}
              key={file.path}
              onClick={() => onSelectFile(file.path)}
            >
              <strong>{file.path}</strong>
              <span>{formatBytes(file.sizeBytes)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>{content?.path ?? "Preview"}</strong>
          <span>{content ? formatBytes(content.sizeBytes) : "-"}</span>
        </div>
        {content ? (
          <>
            <pre className="mini-json artifact-preview">{content.content}</pre>
            {content.truncated ? (
              <div className="runtime-item">
                <strong>Preview truncado</strong>
                <span>Somente parte do arquivo foi carregada.</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="runtime-item">
            <strong>Nenhum arquivo selecionado</strong>
            <span>Nenhum conteúdo carregado.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function RuntimeManifestPanel({
  loaded,
  validation,
  generation,
  outDir,
  onOutDirChange,
  onRefresh,
  onValidate,
  onGenerate,
}: {
  loaded: LoadedRuntimeManifest | null;
  validation: RuntimeManifestValidationResult | null;
  generation: RuntimeManifestGenerateResult | null;
  outDir: string;
  onOutDirChange: (value: string) => void;
  onRefresh: () => void;
  onValidate: () => void;
  onGenerate: () => void;
}) {
  if (!loaded) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhum runtime.manifest.json carregado.</span>
      </div>
    );
  }

  const { manifest } = loaded;
  const generatedAgents = generation?.agents ?? [];
  return (
    <div className="runtime-manifest-body">
      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>{manifest.name}</strong>
          <span className={manifest.packaging === "multiagent" ? "runtime-pill running" : "runtime-pill"}>
            {manifest.packaging}
          </span>
        </div>
        <dl className="kv-list inspector-list">
          <Field label="Arquivo" value={loaded.path} />
          <Field label="ID" value={manifest.id} />
          <Field label="Versão" value={manifest.version} />
          <Field label="LLM padrão" value={manifest.defaultLlm ? `${manifest.defaultLlm.adapter} - ${manifest.defaultLlm.model}` : "-"} />
        </dl>
        <div className="sandbox-actions">
          <button type="button" className="command-button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </button>
          <button type="button" className="command-button" onClick={onValidate}>
            <CheckCircle2 size={16} aria-hidden="true" />
            Validar
          </button>
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Agentes</strong>
          <span>{manifest.agents.length}</span>
        </div>
        <div className="runtime-list compact-list">
          {manifest.agents.map((agent) => (
            <article className="runtime-item" key={agent.id}>
              <strong>{agent.id}</strong>
              <span>{agent.routePrefix || "/"} - {agent.flowPath}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Bundle</strong>
          <span>{generation ? "gerado" : "pronto"}</span>
        </div>
        <div className="edit-group">
          <label>
            <span>Diretório de saída</span>
            <input value={outDir} onChange={(event) => onOutDirChange(event.target.value)} />
          </label>
        </div>
        <button type="button" className="command-button primary full-width" onClick={onGenerate}>
          <Terminal size={16} aria-hidden="true" />
          Gerar bundle
        </button>
        {generation ? (
          <dl className="kv-list inspector-list">
            <Field label="Saída" value={generation.outDir} />
            <Field label="Manifesto" value={generation.manifestPath} />
            <Field label="Agentes gerados" value={String(generatedAgents.length)} />
          </dl>
        ) : null}
      </section>

      {validation ? (
        <section className="sandbox-section">
          <div className="sandbox-header">
            <strong>Validação</strong>
            <span>{validation.status}</span>
          </div>
          <dl className="kv-list inspector-list">
            <Field label="Nome" value={validation.name} />
            <Field label="Empacotamento" value={validation.packaging} />
            <Field label="Agentes válidos" value={String(validation.agents.length)} />
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function SandboxPanel({
  flow,
  selectedPromptId,
  promptContent,
  sandbox,
  sandboxes,
  sandboxPort,
  langGraphApprovalStatus,
  session,
  transcript,
  events,
  timelineEvents,
  timelineNodeFilter,
  selectedEvent,
  selectedStateSnapshot,
  stateSnapshots,
  studioRunCausalAnalysis,
  studioRuns,
  selectedRunId,
  selectedCompareRunId,
  studioRunCompletionFilter,
  studioRunNodeFilter,
  studioScenarios,
  studioSelectedScenarioId,
  studioScenarioLabel,
  studioScenarioTags,
  studioScenarioUseNodePins,
  studioScenarioRegressionThresholds,
  studioScenarioBatchResults,
  studioScenarioBatchApproval,
  studioNodePins,
  userMessage,
  studioRunSearch,
  studioRunStatusFilter,
  studioRunPhaseFilter,
  studioRunMinDurationMsFilter,
  studioRunMaxDurationMsFilter,
  studioRunHasErrorsOnly,
  studioRunComparison,
  setSandboxPort,
  setUserMessage,
  onStudioRunSearchChange,
  onStudioRunNodeFilterChange,
  onStudioRunStatusFilterChange,
  onStudioRunPhaseFilterChange,
  onStudioRunMinDurationMsFilterChange,
  onStudioRunMaxDurationMsFilterChange,
  onStudioRunHasErrorsOnlyChange,
  onStudioRunCompletionFilterChange,
  onStudioRunCompareRunIdChange,
  onStudioScenarioSave,
  onStudioScenarioSelect,
  onStudioScenarioRun,
  onStudioScenarioBatchRun,
  onStudioPinnedScenarioRun,
  onStudioScenarioPin,
  onStudioScenarioDelete,
  onStudioScenarioFixtureExport,
  onStudioScenarioFixtureImport,
  onStudioScenarioBatchReportExport,
  onStudioScenarioBatchApprove,
  onStudioNodePin,
  onStudioNodePinDelete,
  onForkCheckpoint,
  onStudioScenarioLabelChange,
  onStudioScenarioTagsChange,
  onStudioScenarioUseNodePinsChange,
  onStudioScenarioRegressionThresholdChange,
  onExportComparison,
  onClearComparison,
  onSelectEvent,
  onTimelineNodeFilterChange,
  onRefreshRuns,
  onLoadRun,
  onExportRun,
  onStartSandbox,
  onStopSandbox,
  onRefreshSandbox,
  onCreateSession,
  onSendTurn,
  onFinishSession,
  onCompareRuns,
}: {
  flow: AgentFlow | null;
  selectedPromptId: string;
  promptContent: string;
  sandbox: SandboxStatus | null;
  sandboxes: SandboxStatus[];
  sandboxPort: string;
  langGraphApprovalStatus: LangGraphSandboxApprovalStatus | null;
  session: SessionView | null;
  transcript: MessageView[];
  events: EventView[];
  timelineEvents: EventView[];
  timelineNodeFilter: string;
  selectedEvent: EventView | null;
  selectedStateSnapshot: StudioStateSnapshot | null;
  stateSnapshots: StudioStateSnapshot[];
  studioRunCausalAnalysis: StudioRunCausalAnalysis;
  studioRuns: StudioRunSummary[];
  selectedRunId: string;
  selectedCompareRunId: string;
  studioRunCompletionFilter: "" | "complete" | "incomplete";
  studioRunComparison: StudioRunComparison | null;
  studioScenarios: StudioScenario[];
  studioSelectedScenarioId: string;
  studioScenarioLabel: string;
  studioScenarioTags: string;
  studioScenarioUseNodePins: boolean;
  studioScenarioRegressionThresholds: StudioScenarioRegressionThresholds;
  studioScenarioBatchResults: StudioScenarioBatchResult[];
  studioScenarioBatchApproval: StudioScenarioBatchApproval | null;
  studioNodePins: StudioNodePin[];
  userMessage: string;
  studioRunSearch: string;
  studioRunNodeFilter: string;
  studioRunStatusFilter: string;
  studioRunPhaseFilter: string;
  studioRunMinDurationMsFilter: string;
  studioRunMaxDurationMsFilter: string;
  studioRunHasErrorsOnly: boolean;
  setSandboxPort: (value: string) => void;
  setUserMessage: (value: string) => void;
  onStudioRunSearchChange: (value: string) => void;
  onStudioRunNodeFilterChange: (value: string) => void;
  onStudioRunStatusFilterChange: (value: string) => void;
  onStudioRunPhaseFilterChange: (value: string) => void;
  onStudioRunMinDurationMsFilterChange: (value: string) => void;
  onStudioRunMaxDurationMsFilterChange: (value: string) => void;
  onStudioRunHasErrorsOnlyChange: (value: boolean) => void;
  onStudioRunCompletionFilterChange: (value: "" | "complete" | "incomplete") => void;
  onStudioRunCompareRunIdChange: (value: string) => void;
  onExportComparison: () => void;
  onClearComparison: () => void;
  onStudioScenarioSave: () => void;
  onStudioScenarioSelect: (scenarioId: string) => void;
  onStudioScenarioRun: () => void;
  onStudioScenarioBatchRun: () => void;
  onStudioPinnedScenarioRun: () => void;
  onStudioScenarioPin: () => void;
  onStudioScenarioDelete: () => void;
  onStudioScenarioFixtureExport: () => void;
  onStudioScenarioFixtureImport: () => void;
  onStudioScenarioBatchReportExport: () => void;
  onStudioScenarioBatchApprove: () => void;
  onStudioNodePin: (pin: StudioNodePinDraft) => void;
  onStudioNodePinDelete: (pinId: string) => void;
  onForkCheckpoint: () => void;
  onStudioScenarioLabelChange: (value: string) => void;
  onStudioScenarioTagsChange: (value: string) => void;
  onStudioScenarioUseNodePinsChange: (value: boolean) => void;
  onStudioScenarioRegressionThresholdChange: (key: keyof StudioScenarioRegressionThresholds, value: string) => void;
  onSelectEvent: (seq: number) => void;
  onTimelineNodeFilterChange: (value: string) => void;
  onRefreshRuns: () => void;
  onLoadRun: (runId: string) => void;
  onExportRun: () => void;
  onCompareRuns: () => void;
  onStartSandbox: () => void;
  onStopSandbox: () => void;
  onRefreshSandbox: () => void;
  onCreateSession: () => void;
  onSendTurn: () => void;
  onFinishSession: () => void;
}) {
  const running = Boolean(sandbox?.running && sandbox.url);
  const executedNodes = Array.from(new Set(events.map((event) => event.node).filter((node): node is string => Boolean(node))));
  const timelineNodeOptions = Array.from(new Set(timelineEvents.map((event) => event.node).filter((node): node is string => Boolean(node)))).sort();
  const selectedPayload = selectedEvent?.payload ?? {};
  const nodeInput = inferEventInput(selectedEvent, transcript);
  const nodeOutput = inferEventOutput(selectedPayload);
  const selectedNodeContext = buildStudioNodeContext(
    flow,
    timelineNodeFilter || selectedEvent?.node || "",
    events,
    transcript,
    stateSnapshots,
    sandbox?.logs ?? [],
    studioRunCausalAnalysis,
  );
  const selectedFlowNode =
    flow?.nodes.find((node) => node.id === selectedNodeContext?.nodeId) ??
    (selectedNodeContext?.nodeId === "start" ? ({ id: "start", type: "start" } as FlowNode) : null);
  const selectedPromptRef =
    selectedFlowNode?.promptId && flow
      ? flow.prompts.find((prompt) => prompt.id === selectedFlowNode.promptId) ?? null
      : null;
  const selectedPromptText = selectedPromptRef?.id === selectedPromptId ? promptContent : "";
  const selectedNodeLlm = selectedFlowNode && isLlmLikeNode(selectedFlowNode)
    ? {
        ...(flow?.llm ?? {}),
        ...(selectedFlowNode.llm ?? {}),
      }
    : null;
  const selectedNodeHash = hashStudioNodeDefinition(selectedFlowNode);
  const selectedNodePin = selectedNodeContext
    ? studioNodePins.find((pin) => pin.nodeId === selectedNodeContext.nodeId) ?? null
    : null;
  const selectedNodePinIsStale = Boolean(selectedNodePin && selectedNodePin.nodeHash !== selectedNodeHash);
  const renderedPromptPreview = selectedPromptRef && selectedNodeContext
    ? buildRenderedPromptPreview(selectedPromptRef, selectedPromptText, selectedNodeContext, session, transcript)
    : null;
  const hasCausalAnalysis = studioRunCausalAnalysis.failedNode !== null;
  const selectedScenario = studioScenarios.find((scenario) => scenario.id === studioSelectedScenarioId);
  const selectedCheckpointCompatibility = checkpointCompatibilityStatus(
    flow,
    selectedScenario?.checkpoint ?? null,
    langGraphApprovalStatus,
  );
  const pinnedScenario = studioScenarios.find((scenario) => scenario.isPinned);
  const activeNodePinCount = activeStudioNodePins(studioNodePins, flow).length;
  const batchSummary = summarizeStudioScenarioBatchResults(studioScenarioBatchResults);
  const batchReportHash = studioScenarioBatchResults.length > 0
    ? studioScenarioBatchReportHash(flow, batchSummary, studioScenarioBatchResults)
    : "";
  const batchApprovalIsCurrent = Boolean(
    studioScenarioBatchApproval && batchReportHash && studioScenarioBatchApproval.reportHash === batchReportHash,
  );
  const checkpointRestoreEvent = latestCheckpointRestoreEvent(events);
  const checkpointRestorePayload = checkpointRestoreEvent?.payload ?? null;
  const nodeFilterOptions = Array.from(
    new Set(["start", "end", ...((flow?.nodes ?? []).map((node) => node.id))]),
  ).sort();
  return (
    <div className="sandbox-body">
      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Studio Local · {flow?.id ?? "flow"}</strong>
          <span className={running ? "runtime-pill running" : "runtime-pill"}>{running ? "ativo" : "parado"}</span>
        </div>
        <dl className="kv-list inspector-list">
          <Field label="Runtime" value={sandbox?.url ?? "-"} />
          <Field label="Swagger" value={sandbox?.docsUrl ?? "-"} />
          <Field label="Porta atual" value={sandbox?.port ? String(sandbox.port) : "-"} />
          <Field label="PID" value={sandbox?.pid ? String(sandbox.pid) : "-"} />
        </dl>
        <div className="edit-group">
          <label>
            <span>Porta</span>
            <input
              inputMode="numeric"
              value={sandboxPort}
              onChange={(event) => setSandboxPort(event.target.value)}
              disabled={running}
            />
          </label>
        </div>
        <div className="sandbox-actions">
          <button type="button" className="command-button primary" onClick={onStartSandbox} disabled={running}>
            <Play size={16} aria-hidden="true" />
            Iniciar
          </button>
          <button type="button" className="command-button" onClick={onStopSandbox} disabled={!running}>
            <CircleDot size={16} aria-hidden="true" />
            Parar
          </button>
          <button type="button" className="command-button" onClick={onRefreshSandbox}>
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </button>
          {sandbox?.docsUrl ? (
            <a className="link-button" href={sandbox.docsUrl} target="_blank" rel="noreferrer">
              Docs
            </a>
          ) : null}
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Cenários de teste</strong>
          <span>{studioScenarios.length}</span>
        </div>
        <div className="studio-scenario-controls">
          <label>
            <span className="visually-hidden">Selecionar cenário</span>
            <select
              value={studioSelectedScenarioId}
              onChange={(event) => onStudioScenarioSelect(event.target.value)}
            >
              <option value="">Novo cenário</option>
              {studioScenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label}
                  {scenario.isPinned ? " (fixo)" : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedScenario?.isPinned ? <span className="studio-scenario-pin">fixado</span> : null}
        </div>
        <div className="edit-group">
          <label>
            <span>Nome</span>
            <input value={studioScenarioLabel} onChange={(event) => onStudioScenarioLabelChange(event.target.value)} />
          </label>
          <label>
            <span>Tags (separadas por vírgula)</span>
            <input value={studioScenarioTags} onChange={(event) => onStudioScenarioTagsChange(event.target.value)} />
          </label>
          <label className="studio-checkbox-row">
            <input
              type="checkbox"
              checked={studioScenarioUseNodePins}
              onChange={(event) => onStudioScenarioUseNodePinsChange(event.target.checked)}
            />
            <span>Usar pins de nó como mock</span>
            <small>{activeNodePinCount} pin(s) ativo(s) serão enviados na execução</small>
          </label>
          <div className="studio-threshold-grid" aria-label="Thresholds de regressão">
            <label>
              <span>Tokens +%</span>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={studioScenarioRegressionThresholds.tokenGrowthPct}
                onChange={(event) => onStudioScenarioRegressionThresholdChange("tokenGrowthPct", event.target.value)}
              />
            </label>
            <label>
              <span>Custo +%</span>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={studioScenarioRegressionThresholds.costGrowthPct}
                onChange={(event) => onStudioScenarioRegressionThresholdChange("costGrowthPct", event.target.value)}
              />
            </label>
            <label>
              <span>Duração +%</span>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={studioScenarioRegressionThresholds.durationGrowthPct}
                onChange={(event) => onStudioScenarioRegressionThresholdChange("durationGrowthPct", event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="sandbox-actions">
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioSave}
            disabled={!userMessage.trim()}
          >
            <Save size={16} aria-hidden="true" />
            Salvar
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioPin}
            disabled={!studioSelectedScenarioId}
          >
            <Pin size={16} aria-hidden="true" />
            {pinnedScenario ? (selectedScenario?.isPinned ? "Desafixar" : "Fixar") : "Fixar"}
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioRun}
            disabled={!studioSelectedScenarioId}
          >
            <Play size={16} aria-hidden="true" />
            Executar selecionado
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioBatchRun}
            disabled={studioScenarios.length === 0}
          >
            <Play size={16} aria-hidden="true" />
            Executar lote
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioBatchReportExport}
            disabled={studioScenarioBatchResults.length === 0}
          >
            <Download size={16} aria-hidden="true" />
            Exportar relatório
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioBatchApprove}
            disabled={studioScenarioBatchResults.length === 0 || batchApprovalIsCurrent}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            Aprovar lote
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioPinnedScenarioRun}
            disabled={!pinnedScenario}
          >
            <Play size={16} aria-hidden="true" />
            Executar fixado
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioFixtureExport}
            disabled={!studioSelectedScenarioId}
          >
            <Download size={16} aria-hidden="true" />
            Exportar fixture
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onStudioScenarioFixtureImport}
          >
            <Upload size={16} aria-hidden="true" />
            Importar fixture
          </button>
          <button
            type="button"
            className="command-button danger"
            onClick={onStudioScenarioDelete}
            disabled={!studioSelectedScenarioId}
          >
            <Trash2 size={16} aria-hidden="true" />
            Remover
          </button>
        </div>
        {selectedScenario ? (
          <article className="runtime-item">
            <strong>{selectedScenario.label}</strong>
            <small>{selectedScenario.tags.join(", ") || "Sem tags"} · Atualizado em {formatDateTime(selectedScenario.updatedAt)}</small>
            {selectedScenario.checkpoint ? (
              <small>
                Fork de checkpoint: {selectedScenario.checkpoint.sourceRunId} · #{selectedScenario.checkpoint.eventSeq} ·{" "}
                {selectedScenario.checkpoint.nodeId ?? "runtime"}
              </small>
            ) : null}
            {selectedScenario.checkpoint ? (
              <>
                <small>
                  Restore: {restoreStrategyLabel(selectedScenario.checkpoint)} · {checkpointStateShape(selectedScenario.checkpoint)}
                </small>
                <small className={`checkpoint-compatibility ${selectedCheckpointCompatibility.level}`}>
                  {selectedCheckpointCompatibility.label}
                </small>
                {selectedCheckpointCompatibility.reasons.length > 0 ? (
                  <small>{selectedCheckpointCompatibility.reasons.join(" · ")}</small>
                ) : null}
              </>
            ) : null}
            {checkpointRestoreEvent ? (
              <small>
                Restore observado: {restoreEventSourceLabel(checkpointRestorePayload?.source)} · turno{" "}
                {formatRestoreTurn(checkpointRestorePayload?.turn)} · estado {restorePayloadStateKeys(checkpointRestorePayload)}
              </small>
            ) : null}
            {selectedScenario.useNodePins ? (
              <small>Mock por pins de nó: {activeNodePinCount} pin(s) ativo(s)</small>
            ) : null}
            <small>
              Thresholds: tokens +{selectedScenario.regressionThresholds.tokenGrowthPct}% · custo +{selectedScenario.regressionThresholds.costGrowthPct}% · duração +{selectedScenario.regressionThresholds.durationGrowthPct}%
            </small>
            <span>Último uso: {selectedScenario.lastUsedAt ? formatDateTime(selectedScenario.lastUsedAt) : "nunca"}</span>
          </article>
        ) : (
          <article className="runtime-item">
            <strong>Nenhum cenário selecionado</strong>
            <span>Digite a mensagem e salve para criar um novo cenário.</span>
          </article>
        )}
        {studioScenarioBatchResults.length ? (
          <div className="node-pin-list" aria-label="Resultado do lote de cenários">
            <article className={`runtime-item ${batchSummary.severity === "error" || batchSummary.severity === "fail" ? "error" : ""}`}>
              <strong>Resumo do lote</strong>
              <small>
                {batchSummary.okCount}/{batchSummary.resultCount} ok · {batchSummary.errorCount} erro(s) ·{" "}
                {batchSummary.passCount} pass · {batchSummary.warnCount} aviso(s) · {batchSummary.failCount} falha(s) ·{" "}
                {batchSummary.missingBaselineCount} sem baseline
              </small>
              <small>
                Severidade {formatBatchReportSeverity(batchSummary.severity)} · hash {batchReportHash}
              </small>
              <span>
                {batchApprovalIsCurrent
                  ? `Aprovado em ${formatDateTime(studioScenarioBatchApproval?.approvedAt ?? "")}.`
                  : "Aguardando aprovação local do lote atual."}
              </span>
            </article>
            {studioScenarioBatchResults.map((result) => (
              <article className={`runtime-item ${result.status === "error" ? "error" : ""}`} key={`${result.scenarioId}-${result.completedAt}`}>
                <strong>{result.label}</strong>
                <small>
                  {result.status === "ok" ? "ok" : "erro"} · sessão {result.sessionId ? result.sessionId.slice(0, 8) : "-"} · run{" "}
                  {result.runId ? result.runId.slice(0, 18) : "-"} · {result.durationMs !== null ? `${result.durationMs}ms` : "-"} ·{" "}
                  {formatDateTime(result.completedAt)}
                </small>
                <small>
                  Comparação: {formatBatchComparisonSeverity(result.comparison.severity)} · baseline{" "}
                  {result.comparison.baselineRunId ? result.comparison.baselineRunId.slice(0, 18) : "-"} · candidate{" "}
                  {result.comparison.candidateRunId ? result.comparison.candidateRunId.slice(0, 18) : "-"}
                </small>
                <span>{result.message}</span>
                <span>{result.comparison.verdict}</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Pins de nó</strong>
          <span>{studioNodePins.length}</span>
        </div>
        {studioNodePins.length ? (
          <div className="node-pin-list">
            {studioNodePins.map((pin) => {
              const currentNode = studioPinNodeForHash(flow, pin.nodeId);
              const stale = hashStudioNodeDefinition(currentNode) !== pin.nodeHash;
              return (
                <article className={`node-pin-row ${stale ? "stale" : ""}`} key={pin.id}>
                  <div>
                    <strong>{pin.nodeId}</strong>
                    <span>{pin.nodeType} · #{pin.eventSeq} · {pin.eventType}</span>
                    <small>{stale ? "stale: definição do nó mudou" : "atual"} · {formatDateTime(pin.updatedAt)}</small>
                  </div>
                  <button type="button" className="icon-button" title="Remover pin de nó" onClick={() => onStudioNodePinDelete(pin.id)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <article className="runtime-item">
            <strong>Nenhum pin de nó</strong>
            <span>Abra um nó executado e use Fixar IO para congelar input/output localmente.</span>
          </article>
        )}
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Run atual</strong>
          <span>{session?.session_id ? session.session_id.slice(0, 8) : "sem sessão"}</span>
        </div>
        <div className="studio-metrics">
          <Field label="Status" value={session?.status ?? "-"} />
          <Field label="Fase" value={session?.phase ?? "-"} />
          <Field label="Turno" value={session ? `${session.turn}/${session.max_turns}` : "-"} />
          <Field label="Nós" value={String(executedNodes.length)} />
          <Field label="Eventos" value={String(events.length)} />
          <Field label="Mensagens" value={String(transcript.length)} />
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Runs locais</strong>
          <span>{studioRuns.length}</span>
        </div>
        <div className="studio-run-controls">
          <label>
            <span className="visually-hidden">Comparar com run</span>
            <select
              value={selectedCompareRunId}
              onChange={(event) => onStudioRunCompareRunIdChange(event.target.value)}
              disabled={studioRuns.length < 2}
            >
              <option value="">Comparar com...</option>
              {studioRuns.map((run) => (
                <option key={`compare-${run.id}`} value={run.id}>
                  {run.sessionId}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="command-button"
            onClick={onCompareRuns}
            disabled={!selectedCompareRunId || !selectedRunId || selectedCompareRunId === selectedRunId}
          >
            <GitCompare size={16} aria-hidden="true" />
            Comparar
          </button>
          <button type="button" className="command-button" onClick={onExportComparison} disabled={!studioRunComparison}>
            <Download size={16} aria-hidden="true" />
            Exportar comparação
          </button>
          <button type="button" className="command-button" onClick={onClearComparison} disabled={!studioRunComparison}>
            <Trash2 size={16} aria-hidden="true" />
            Limpar
          </button>
          <input
            className="search-input"
            type="text"
            placeholder="Buscar por sessão, status, fase..."
            value={studioRunSearch}
            onChange={(event) => onStudioRunSearchChange(event.target.value)}
          />
          <input
            className="search-input"
            type="text"
            list="studio-run-node-filter-options"
            placeholder="Filtrar por nó..."
            value={studioRunNodeFilter}
            onChange={(event) => onStudioRunNodeFilterChange(event.target.value)}
          />
          <label>
            <span className="visually-hidden">Filtrar por status</span>
            <select value={studioRunStatusFilter} onChange={(event) => onStudioRunStatusFilterChange(event.target.value)}>
              <option value="">Todos</option>
              <option value="created">created</option>
              <option value="running">running</option>
              <option value="completed">completed</option>
              <option value="error">error</option>
            </select>
          </label>
          <label>
            <span className="visually-hidden">Filtrar por fase</span>
            <select value={studioRunPhaseFilter} onChange={(event) => onStudioRunPhaseFilterChange(event.target.value)}>
              <option value="">Todas</option>
              <option value="created">created</option>
              <option value="collecting">collecting</option>
              <option value="processing">processing</option>
              <option value="finalizing">finalizing</option>
              <option value="completed">completed</option>
              <option value="error">error</option>
            </select>
          </label>
          <input
            className="search-input"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="Duração mínima (ms)"
            value={studioRunMinDurationMsFilter}
            onChange={(event) => onStudioRunMinDurationMsFilterChange(event.target.value)}
          />
          <input
            className="search-input"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="Duração máxima (ms)"
            value={studioRunMaxDurationMsFilter}
            onChange={(event) => onStudioRunMaxDurationMsFilterChange(event.target.value)}
          />
          <label>
            <span className="visually-hidden">Filtrar por finalização</span>
            <select
              value={studioRunCompletionFilter}
              onChange={(event) => onStudioRunCompletionFilterChange(event.target.value as "" | "complete" | "incomplete")}
            >
              <option value="">Todas</option>
              <option value="complete">Concluídas</option>
              <option value="incomplete">Incompletas</option>
            </select>
          </label>
          <label className="studio-run-error-filter">
            <input
              type="checkbox"
              checked={studioRunHasErrorsOnly}
              onChange={(event) => onStudioRunHasErrorsOnlyChange(event.target.checked)}
            />
            <span>Somente erros</span>
          </label>
        </div>
        <datalist id="studio-run-node-filter-options">
          {nodeFilterOptions.map((nodeId) => (
            <option key={`studio-run-node-filter-${nodeId}`} value={nodeId} />
          ))}
        </datalist>
        <div className="sandbox-actions">
          <button type="button" className="command-button" onClick={onRefreshRuns}>
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </button>
          <button
            type="button"
            className="command-button"
            onClick={onExportRun}
            disabled={!selectedRunId}
          >
            <Download size={16} aria-hidden="true" />
            Exportar selecionado
          </button>
        </div>
        <div className="studio-run-list">
          {studioRunComparison ? (
            <article className="runtime-item studio-comparison-item">
              <strong>Comparação</strong>
              <span>
                {studioRunComparison.leftRunId} vs {studioRunComparison.rightRunId}
              </span>
              <div className={`studio-regression-banner ${studioRunComparison.regression.severity}`}>
                <strong>{studioRunComparison.regression.severity === "fail" ? "falha" : studioRunComparison.regression.severity === "warn" ? "atenção" : "ok"}</strong>
                <span>{studioRunComparison.regression.verdict}</span>
              </div>
              <div className="studio-comparison-grid">
                <div>
                  <strong>status</strong>
                  <span>{studioRunComparison.metrics.statusChanged ? "diferente" : "igual"}</span>
                </div>
                <div>
                  <strong>fase</strong>
                  <span>{studioRunComparison.metrics.phaseChanged ? "diferente" : "igual"}</span>
                </div>
                <div>
                  <strong>finalizado</strong>
                  <span>{studioRunComparison.metrics.isCompleteChanged ? "diferente" : "igual"}</span>
                </div>
                <div>
                  <strong>nodes</strong>
                  <span>
                    {studioRunComparison.left.nodeCount} para {studioRunComparison.right.nodeCount} (
                    {studioRunComparison.metrics.nodeCountDelta >= 0 ? "+" : ""}
                    {studioRunComparison.metrics.nodeCountDelta})
                  </span>
                </div>
                <div>
                  <strong>eventos</strong>
                  <span>
                    {studioRunComparison.left.eventCount} para {studioRunComparison.right.eventCount} (
                    {studioRunComparison.metrics.eventCountDelta >= 0 ? "+" : ""}
                    {studioRunComparison.metrics.eventCountDelta})
                  </span>
                </div>
                <div>
                  <strong>erros</strong>
                  <span>
                    {studioRunComparison.left.errorCount} para {studioRunComparison.right.errorCount} (
                    {studioRunComparison.metrics.errorCountDelta >= 0 ? "+" : ""}
                    {studioRunComparison.metrics.errorCountDelta})
                  </span>
                </div>
                <div>
                  <strong>mensagens</strong>
                  <span>
                    {studioRunComparison.left.messageCount} para {studioRunComparison.right.messageCount} (
                    {studioRunComparison.metrics.messageCountDelta >= 0 ? "+" : ""}
                    {studioRunComparison.metrics.messageCountDelta})
                  </span>
                </div>
                <div>
                  <strong>duração</strong>
                  <span>
                    {formatRunDuration(studioRunComparison.metrics.durationMsLeft)} para{" "}
                    {formatRunDuration(studioRunComparison.metrics.durationMsRight)}
                  </span>
                </div>
                <div>
                  <strong>modo</strong>
                  <span>
                    {studioRunComparison.metrics.runKindLeft} para {studioRunComparison.metrics.runKindRight}
                  </span>
                </div>
                <div>
                  <strong>pins</strong>
                  <span>
                    {studioRunComparison.metrics.pinnedEventCountLeft} para {studioRunComparison.metrics.pinnedEventCountRight} (
                    {studioRunComparison.metrics.pinnedEventCountDelta >= 0 ? "+" : ""}
                    {studioRunComparison.metrics.pinnedEventCountDelta})
                  </span>
                </div>
                <div>
                  <strong>mock</strong>
                  <span>
                    {studioRunComparison.metrics.mockEventCountLeft} para {studioRunComparison.metrics.mockEventCountRight} (
                    {studioRunComparison.metrics.mockEventCountDelta >= 0 ? "+" : ""}
                    {studioRunComparison.metrics.mockEventCountDelta})
                  </span>
                </div>
                <div>
                  <strong>tokens</strong>
                  <span>
                    {formatNullableNumber(studioRunComparison.metrics.totalTokensLeft)} para{" "}
                    {formatNullableNumber(studioRunComparison.metrics.totalTokensRight)}
                  </span>
                </div>
                <div>
                  <strong>custo</strong>
                  <span>
                    {formatUsd(studioRunComparison.metrics.totalCostUsdLeft)} para{" "}
                    {formatUsd(studioRunComparison.metrics.totalCostUsdRight)}
                  </span>
                </div>
              </div>
              <small>
                Só no {studioRunComparison.leftRunId}: {studioRunComparison.leftOnlyNodes.join(", ") || "-"} <br />
                Só no {studioRunComparison.rightRunId}: {studioRunComparison.rightOnlyNodes.join(", ") || "-"} <br />
                Runtime URL: {studioRunComparison.metrics.runtimeUrlChanged ? "diferente" : "igual"} ·{" "}
                Pinado vs real: {studioRunComparison.regression.comparesPinnedToLive ? "sim" : "não"}
              </small>
              <small>
                Thresholds: tokens +{studioRunComparison.regression.appliedThresholds.tokenGrowthPct}% · custo +
                {studioRunComparison.regression.appliedThresholds.costGrowthPct}% · duração +
                {studioRunComparison.regression.appliedThresholds.durationGrowthPct}%
              </small>
              {studioRunComparison.regression.reasons.length ? (
                <small>Motivos: {studioRunComparison.regression.reasons.join("; ")}</small>
              ) : null}
              <small>
                Em comum: {studioRunComparison.nodeDiff.both.length} nós · Mudanças:{" "}
                {studioRunComparison.nodeComparisons.filter((item) => item.changed).length}
              </small>
              {studioRunComparison.nodeComparisons.some((node) => node.inLeft && node.inRight && node.changed) ? (
                <details>
                  <summary>Detalhar diffs semânticos dos nós em comum</summary>
                  <div className="studio-node-diff-list">
                    {studioRunComparison.nodeComparisons
                      .filter((node) => node.inLeft && node.inRight && node.changed)
                      .slice(0, 8)
                      .map((node) => (
                        <div key={`node-comparison-${node.nodeId}`}>
                          <strong>{node.nodeId}</strong>
                          <span>
                            state {node.stateDiff.length} · output {node.outputDiff.length} · left#{node.left.seq ?? "-"} → right#
                            {node.right.seq ?? "-"}
                          </span>
                          <pre className="mini-json">
                            {JSON.stringify(
                              {
                                leftState: node.left,
                                rightState: node.right,
                                stateDiff: node.stateDiff.slice(0, 4),
                                outputDiff: node.outputDiff.slice(0, 4),
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      ))}
                  </div>
                </details>
              ) : null}
            </article>
          ) : null}
          {studioRuns.length ? (
            studioRuns.slice(0, 12).map((run) => (
              <button
                type="button"
                className={`studio-run-item ${run.id === selectedRunId ? "selected" : ""}`}
                key={run.id}
                onClick={() => onLoadRun(run.id)}
              >
                <span className="studio-run-main">
                  <strong>{run.sessionId}</strong>
                  <small>
                    {run.phase} · {run.status} · {formatDateTime(run.updatedAt)}
                  </small>
                </span>
                <span className="studio-run-metrics">
                  {run.eventCount} ev · {run.nodeCount} nós
                </span>
              </button>
            ))
          ) : (
            <article className="runtime-item">
              <strong>Nenhum run persistido</strong>
              <span>Execute uma sessão no sandbox para salvar o primeiro snapshot local.</span>
            </article>
          )}
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Sessão</strong>
          <span>{session?.status ?? "-"}</span>
        </div>
        <div className="sandbox-actions">
          <button type="button" className="command-button" onClick={onCreateSession} disabled={!running}>
            Criar
          </button>
          <button type="button" className="command-button" onClick={onFinishSession} disabled={!running || !session}>
            Finalizar
          </button>
        </div>
        <textarea
          className="turn-input"
          value={userMessage}
          onChange={(event) => setUserMessage(event.target.value)}
          rows={3}
        />
        <button type="button" className="command-button primary full-width" onClick={onSendTurn} disabled={!running || !session}>
          Enviar turno
        </button>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Timeline</strong>
              <span>{timelineEvents.length}</span>
            </div>
            <div className="timeline-toolbar">
              <label>
                <span className="visually-hidden">Filtrar timeline por nó</span>
                <select
                  value={timelineNodeFilter}
                  onChange={(event) => onTimelineNodeFilterChange(event.target.value)}
                  title="Filtrar eventos por nó"
                >
                  <option value="">Todos</option>
                  {timelineNodeOptions.map((nodeId) => (
                    <option value={nodeId} key={`timeline-node-filter-${nodeId}`}>
                      {nodeId}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="command-button"
                onClick={() => onTimelineNodeFilterChange("")}
                disabled={!timelineNodeFilter}
              >
                Limpar filtro
              </button>
            </div>
            <div className="timeline-list">
              {timelineEvents.length ? (
                timelineEvents.map((event) => (
                  <button
                    type="button"
                    className={`timeline-item ${selectedEvent?.seq === event.seq ? "selected" : ""} ${studioEventCausalClass(event, studioRunCausalAnalysis)}`}
                    key={event.seq}
                    onClick={() => onSelectEvent(event.seq)}
                  >
                <span className="timeline-seq">#{event.seq}</span>
                <span className="timeline-main">
                  <strong>{event.event_type}</strong>
                  <small>{event.node ?? "runtime"}</small>
                </span>
                <span className="timeline-turn">t{String(event.payload.turn ?? "-")}</span>
              </button>
            ))
              ) : (
                <article className="runtime-item">
                  <strong>Nenhum evento ainda</strong>
                  <span>Crie uma sessão e envie um turno para registrar a execução local.</span>
                </article>
              )}
            </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Cadeia causal</strong>
          <span>{hasCausalAnalysis ? "com falha" : "sem falha"}</span>
        </div>
        {hasCausalAnalysis ? (
          <div className="causal-grid">
            <div>
              <strong>Falha</strong>
              <pre className="mini-json">{studioRunCausalAnalysis.failedEventType ?? "-"}</pre>
              <small>Nó: {studioRunCausalAnalysis.failedNode ?? "-"}</small>
              <small>Evento: #{studioRunCausalAnalysis.failedEventSeq ?? "-"}</small>
            </div>
            <div>
              <strong>Origem (upstream)</strong>
              <div className="causal-path">
                {studioRunCausalAnalysis.upstreamPath.length ? studioRunCausalAnalysis.upstreamPath.join(" → ") : "-"}
              </div>
            </div>
            <div>
              <strong>Impactados</strong>
              <div className="causal-path">
                {studioRunCausalAnalysis.impactedNodes.length ? studioRunCausalAnalysis.impactedNodes.join(", ") : "-"}
              </div>
            </div>
            <div>
              <strong>Trajetória de impacto</strong>
              <div className="causal-path">
                {studioRunCausalAnalysis.impactPath.length ? studioRunCausalAnalysis.impactPath.join(" → ") : "-"}
              </div>
            </div>
          </div>
        ) : (
          <article className="runtime-item">
            <strong>Nenhuma falha registrada</strong>
            <span>Abra a timeline para executar e gerar a cadeia de impacto após um evento com erro.</span>
          </article>
        )}
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Node IO</strong>
          <span>{selectedEvent?.node ?? "-"}</span>
        </div>
        {selectedEvent ? (
          <div className="node-io-grid">
            <div>
              <strong>Input inferido</strong>
              <pre className="mini-json">{formatInspectorValue(nodeInput)}</pre>
            </div>
            <div>
              <strong>Output</strong>
              <pre className="mini-json">{formatInspectorValue(nodeOutput)}</pre>
            </div>
            <div className="node-io-wide">
              <strong>Payload do evento</strong>
              <pre className="mini-json">{formatInspectorValue(selectedPayload)}</pre>
            </div>
          </div>
        ) : (
          <article className="runtime-item">
            <strong>Nenhum evento selecionado</strong>
            <span>A timeline seleciona o último evento automaticamente quando há execução.</span>
          </article>
        )}
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Contexto do nó</strong>
          <span>{selectedNodeContext?.nodeId ?? "sem nó"}</span>
        </div>
        {selectedNodeContext ? (
          <div className="node-context-stack">
            <div className="node-context-grid">
              <article className="node-context-card">
                <strong>Status</strong>
                <span className={nodeContextStatusClass(selectedNodeContext.status)}>
                  {selectedNodeContext.status}
                </span>
                <small>
                  {selectedNodeContext.events.length} evento(s) · último #{selectedNodeContext.latestEvent?.seq ?? "-"}
                </small>
              </article>
              <article className="node-context-card">
                <strong>Causalidade</strong>
                <span>{selectedNodeContext.causalRole}</span>
                <small>
                  falha #{studioRunCausalAnalysis.failedEventSeq ?? "-"} · {studioRunCausalAnalysis.failedNode ?? "-"}
                </small>
              </article>
              <article className="node-context-card">
                <strong>Erro relacionado</strong>
                <span>{selectedNodeContext.errorEvent?.event_type ?? "-"}</span>
                <small>evento #{selectedNodeContext.errorEvent?.seq ?? "-"}</small>
              </article>
              <article className="node-context-card">
                <strong>Snapshot</strong>
                <span>#{selectedNodeContext.latestSnapshot?.seq ?? "-"}</span>
                <small>{selectedNodeContext.diffs.length} diff(s) do nó</small>
              </article>
              <article className="node-context-card">
                <strong>Definição</strong>
                <span>{selectedFlowNode?.type ?? "runtime"}</span>
                <small>{selectedFlowNode?.description ?? selectedFlowNode?.handler ?? selectedFlowNode?.id ?? "-"}</small>
              </article>
              <article className="node-context-card">
                <strong>Prompt</strong>
                <span>{selectedPromptRef?.id ?? "-"}</span>
                <small>{selectedPromptRef ? `${selectedPromptRef.version} · ${selectedPromptRef.path}` : "sem prompt vinculado"}</small>
              </article>
              <article className="node-context-card">
                <strong>LLM</strong>
                <span>{formatLlmContextValue(selectedNodeLlm, "model")}</span>
                <small>{formatLlmContextValue(selectedNodeLlm, "adapter")}</small>
              </article>
            </div>

            <div className={`node-pin-panel ${selectedNodePinIsStale ? "stale" : selectedNodePin ? "active" : ""}`}>
              <div>
                <strong>Pin de dados do nó</strong>
                <span>
                  {selectedNodePin
                    ? `${selectedNodePinIsStale ? "stale" : "atual"} · evento #${selectedNodePin.eventSeq} · ${formatDateTime(selectedNodePin.updatedAt)}`
                    : "sem pin"}
                </span>
              </div>
              <button
                type="button"
                className="command-button"
                disabled={!selectedNodeContext.latestEvent}
                onClick={() => {
                  if (!selectedNodeContext.latestEvent) {
                    return;
                  }
                  onStudioNodePin({
                    nodeId: selectedNodeContext.nodeId,
                    nodeType: selectedFlowNode?.type ?? "runtime",
                    runId: selectedRunId || "run-atual",
                    sessionId: session?.session_id ?? readStringValue(selectedNodeContext.latestEvent.payload.session_id),
                    eventSeq: selectedNodeContext.latestEvent.seq,
                    eventType: selectedNodeContext.latestEvent.event_type,
                    nodeHash: selectedNodeHash,
                    input: selectedNodeContext.input,
                    output: buildStudioNodePinOutput(selectedNodeContext),
                  });
                }}
              >
                <Pin size={16} aria-hidden="true" />
                Fixar IO
              </button>
            </div>

            <div className={`node-context-diagnosis ${selectedNodeContext.diagnosis.severity}`}>
              <div className="node-context-section-header">
                <strong>Diagnóstico</strong>
                <span>{selectedNodeContext.diagnosis.title}</span>
              </div>
              <div className="node-context-diagnosis-body">
                <div>
                  <strong>Causa provável</strong>
                  <p>{selectedNodeContext.diagnosis.probableCause}</p>
                </div>
                <div>
                  <strong>Próximas ações</strong>
                  <ul>
                    {selectedNodeContext.diagnosis.nextActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
                {selectedNodeContext.diagnosis.evidence.length ? (
                  <div>
                    <strong>Evidências</strong>
                    <div className="node-context-evidence">
                      {selectedNodeContext.diagnosis.evidence.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="node-context-events">
              {selectedNodeContext.events.slice(-6).map((event) => (
                <button
                  type="button"
                  className={`node-context-event ${selectedEvent?.seq === event.seq ? "selected" : ""}`}
                  key={`node-context-${event.seq}`}
                  onClick={() => onSelectEvent(event.seq)}
                >
                  <span>#{event.seq}</span>
                  <strong>{event.event_type}</strong>
                  <small>{String(event.payload.status ?? event.payload.phase ?? "-")}</small>
                </button>
              ))}
            </div>

            <div className="node-io-grid">
              <div>
                <strong>Input do nó</strong>
                <pre className="mini-json">{formatInspectorValue(selectedNodeContext.input)}</pre>
              </div>
              <div>
                <strong>Output do nó</strong>
                <pre className="mini-json">{formatInspectorValue(selectedNodeContext.output)}</pre>
              </div>
              <div className="node-io-wide">
                <strong>Estado do nó</strong>
                <pre className="mini-json">{formatInspectorValue(selectedNodeContext.nodeState)}</pre>
              </div>
            </div>

            {renderedPromptPreview ? (
              <div className="node-context-section">
                <div className="node-context-section-header">
                  <strong>Prompt renderizado</strong>
                  <span>{renderedPromptPreview.path}</span>
                </div>
                <pre className="mini-json">
                  {formatInspectorValue({
                    promptId: renderedPromptPreview.promptId,
                    version: renderedPromptPreview.version,
                    content: renderedPromptPreview.content,
                    variables: renderedPromptPreview.variables,
                    missingVariables: renderedPromptPreview.missingVariables,
                  })}
                </pre>
              </div>
            ) : null}

            {selectedNodeContext.metrics.length ? (
              <div className="node-context-section">
                <div className="node-context-section-header">
                  <strong>Métricas do nó</strong>
                  <span>{selectedNodeContext.metrics.length}</span>
                </div>
                <div className="node-context-metrics">
                  {selectedNodeContext.metrics.map((metric) => (
                    <article className="node-context-metric" key={`${metric.label}-${metric.detail}`}>
                      <strong>{metric.label}</strong>
                      <span>{metric.value}</span>
                      <small>{metric.detail}</small>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedNodeContext.spans.length ? (
              <div className="node-context-section">
                <div className="node-context-section-header">
                  <strong>Spans estruturados</strong>
                  <span>{selectedNodeContext.spans.length}</span>
                </div>
                <div className="node-context-spans">
                  {selectedNodeContext.spans.slice(-8).map((span, index) => (
                    <article className="node-context-span" key={`${span.eventSeq}-${span.name}-${index}`}>
                      <strong>{span.name}</strong>
                      <span>{span.status}</span>
                      <small>
                        #{span.eventSeq} · {span.durationMs === null ? "-" : formatRunDuration(span.durationMs)}
                        {span.tokens === null ? "" : ` · ${span.tokens} tokens`}
                        {span.cost ? ` · ${span.cost}` : ""}
                      </small>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedNodeContext.diffs.length ? (
              <div className="state-diff-list">
                {selectedNodeContext.diffs.slice(0, 8).map((entry, index) => (
                  <article className="state-diff-row" key={`node-context-diff-${entry.path}-${index}`}>
                    <strong>{entry.kind}</strong>
                    <span>{entry.path}</span>
                    <small>{formatDiffValue(entry.after)}</small>
                  </article>
                ))}
              </div>
            ) : null}

            {selectedNodeContext.logs.length ? (
              <div className="node-context-logs">
                {selectedNodeContext.logs.map((line, index) => (
                  <code key={`node-context-log-${index}`}>{line}</code>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <article className="runtime-item">
            <strong>Nenhum nó filtrado</strong>
            <span>Clique em um nó no grafo enquanto estiver no Studio para abrir o contexto operacional dele.</span>
          </article>
        )}
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>State inspector</strong>
          <span>{selectedStateSnapshot ? `#${selectedStateSnapshot.seq}` : session?.is_complete ? "completa" : "ativa"}</span>
        </div>
        <div className="sandbox-actions">
          <button type="button" className="command-button" onClick={onForkCheckpoint} disabled={!selectedEvent}>
            <GitBranch size={16} aria-hidden="true" />
            Criar fork
          </button>
        </div>
        {checkpointRestoreEvent ? (
          <article className="runtime-item">
            <strong>Restore de checkpoint</strong>
            <small>
              Origem: {restoreEventSourceLabel(checkpointRestorePayload?.source)} · sessão{" "}
              {formatRestoreSessionId(checkpointRestorePayload?.sourceSessionId)} · turno{" "}
              {formatRestoreTurn(checkpointRestorePayload?.turn)}
            </small>
            <span>Estado: {restorePayloadStateKeys(checkpointRestorePayload)}</span>
          </article>
        ) : null}
        <pre className="mini-json">{formatInspectorValue(selectedStateSnapshot?.state ?? session ?? { status: "no_session" })}</pre>
        {selectedStateSnapshot?.diff.length ? (
          <div className="state-diff-list">
            {selectedStateSnapshot.diff.slice(0, 12).map((entry, index) => (
              <article className="state-diff-row" key={`${entry.path}-${index}`}>
                <strong>{entry.kind}</strong>
                <span>{entry.path}</span>
                <small>{formatDiffValue(entry.after)}</small>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Transcript</strong>
          <span>{transcript.length}</span>
        </div>
        <div className="runtime-list">
          {transcript.map((message) => (
            <article className="runtime-item" key={message.seq}>
              <strong>
                {message.role}
                {message.code ? ` · ${message.code}` : ""}
              </strong>
              <span>{message.content}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Eventos brutos</strong>
          <span>{events.length}</span>
        </div>
        <div className="runtime-list compact-list">
          {events.map((event) => (
            <article className="runtime-item" key={event.seq}>
              <strong>{event.event_type}</strong>
              <span>{event.node ?? "-"}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>Runtimes</strong>
          <span>{sandboxes.length}</span>
        </div>
        <div className="runtime-list compact-list">
          {sandboxes.length ? (
            sandboxes.map((item) => (
              <article className="runtime-item" key={`${item.flowId}-${item.port ?? "none"}`}>
                <strong>{item.flowId}</strong>
                <span>{item.running ? `ativo em ${item.url}` : "parado"} - PID {item.pid ?? "-"}</span>
              </article>
            ))
          ) : (
            <article className="runtime-item">
              <strong>Nenhum runtime ativo</strong>
              <span>Sem runtime local para o flow selecionado.</span>
            </article>
          )}
        </div>
      </section>

      {sandbox?.logs.length ? (
        <section className="sandbox-section">
          <div className="sandbox-header">
            <strong>Logs</strong>
            <span>{running ? "ao vivo" : String(sandbox.logs.length)}</span>
          </div>
          <pre className="mini-json">{sandbox.logs.slice(-24).join("\n")}</pre>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const value = window.localStorage.getItem(themeStorageKey);
  if (value === "dark" || value === "light") {
    return value;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function langGraphApprovalStatusLabel(status: LangGraphSandboxApprovalStatus | null): string {
  if (!status) {
    return "Aprovação: desconhecida";
  }
  if (status.status === "approved") {
    return "Aprovação: aprovada";
  }
  if (status.status === "missing") {
    return "Aprovação: pendente";
  }
  if (status.status === "outdated") {
    return "Aprovação: desatualizada";
  }
  return "Aprovação: inválida";
}

function langGraphApprovalStatusClass(status: LangGraphSandboxApprovalStatus | null): string {
  if (!status) {
    return "approval-pill approval-pill-unknown";
  }
  if (status.status === "approved") {
    return "approval-pill approval-pill-ok";
  }
  if (status.status === "missing") {
    return "approval-pill approval-pill-pending";
  }
  if (status.status === "outdated") {
    return "approval-pill approval-pill-outdated";
  }
  return "approval-pill approval-pill-error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatInspectorValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

  function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "removido";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatRunDuration(valueMs: number | null): string {
  if (valueMs === null || !Number.isFinite(valueMs) || valueMs < 0) {
    return "-";
  }
  if (valueMs === 0) {
    return "0ms";
  }
  const safeMs = Math.round(valueMs);
  const seconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  if (seconds > 0) {
    const ms = safeMs % 1000;
    if (ms === 0) {
      return `${seconds}s`;
    }
    return `${seconds}.${String(ms).padStart(3, "0")}s`;
  }
  return `${safeMs}ms`;
}

function formatBatchComparisonSeverity(severity: StudioScenarioBatchComparisonSeverity): string {
  if (severity === "pass") {
    return "ok";
  }
  if (severity === "warn") {
    return "atenção";
  }
  if (severity === "fail") {
    return "falha";
  }
  if (severity === "missing") {
    return "sem baseline";
  }
  return "erro";
}

function formatBatchReportSeverity(severity: StudioScenarioBatchReportSeverity): string {
  if (severity === "pass") {
    return "ok";
  }
  if (severity === "warn") {
    return "atenção";
  }
  if (severity === "fail") {
    return "falha";
  }
  return "erro";
}

function formatNullableNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return `$${value.toFixed(6)}`;
}

function inferEventInput(event: EventView | null, transcript: MessageView[]): unknown {
  if (!event) {
    return null;
  }
  const payload = event.payload;
  const custom = isRecord(payload.custom) ? payload.custom : null;
  if (custom && isRecord(custom.contract) && typeof custom.contract.input_path === "string") {
    return { input_path: custom.contract.input_path };
  }
  const lastUserMessage = [...transcript].reverse().find((message) => message.role === "user");
  if (lastUserMessage) {
    return { role: "user", content: lastUserMessage.content };
  }
  return { event_type: event.event_type, node: event.node ?? null };
}

function inferEventOutput(payload: Record<string, unknown>): unknown {
  const custom = isRecord(payload.custom) ? payload.custom : null;
  if (custom && "output" in custom) {
    return custom.output;
  }
  for (const key of ["llm", "http", "transform", "database", "file", "rag", "approval", "score", "analytics", "safety"]) {
    const value = payload[key];
    if (value !== undefined) {
      return value;
    }
  }
  return {
    status: payload.status,
    phase: payload.phase,
    turn: payload.turn,
  };
}

function buildStudioNodePinOutput(context: StudioNodeDebugContext): unknown {
  const output = isRecord(context.output) ? { ...context.output } : context.output;
  const nodeState = isRecord(context.nodeState) ? context.nodeState : null;
  const assistantMessage = isRecord(nodeState?.assistant_message)
    ? nodeState.assistant_message
    : isRecord(nodeState?.assistantMessage)
      ? nodeState.assistantMessage
      : null;
  if (assistantMessage && isRecord(output)) {
    return { ...output, assistant_message: assistantMessage };
  }
  if (assistantMessage) {
    return { value: output, assistant_message: assistantMessage };
  }
  return output;
}

function buildStudioNodeContext(
  flow: AgentFlow | null | undefined,
  nodeId: string,
  events: EventView[],
  transcript: MessageView[],
  stateSnapshots: StudioStateSnapshot[],
  logs: string[],
  causalAnalysis: StudioRunCausalAnalysis,
): StudioNodeDebugContext | null {
  const selectedNodeId = nodeId.trim();
  if (!selectedNodeId) {
    return null;
  }
  const nodeEvents = events.filter((event) => event.node === selectedNodeId).sort((left, right) => left.seq - right.seq);
  const latestEvent = nodeEvents.at(-1) ?? null;
  const errorEvent = nodeEvents.filter(isStudioErrorEvent).at(-1) ?? null;
  const flowNode = findStudioFlowNode(flow, selectedNodeId);
  const latestSnapshot =
    [...stateSnapshots]
      .reverse()
      .find((snapshot) => snapshot.node === selectedNodeId || snapshotHasNode(snapshot, selectedNodeId)) ?? null;
  const nodeState = latestSnapshot ? readSnapshotNodeState(latestSnapshot, selectedNodeId) : null;
  const nodeOutput = latestSnapshot ? readSnapshotNodeOutput(latestSnapshot, selectedNodeId) : undefined;
  const relatedDiffs = latestSnapshot
    ? latestSnapshot.diff.filter((entry) => isNodeRelatedDiff(entry.path, selectedNodeId))
    : [];

  return {
    nodeId: selectedNodeId,
    status: readNodeContextStatus(latestEvent, latestSnapshot),
    causalRole: readNodeCausalRole(selectedNodeId, causalAnalysis),
    events: nodeEvents,
    latestEvent,
    errorEvent,
    latestSnapshot,
    nodeState,
    input: inferEventInput(latestEvent, transcript),
    output: nodeOutput !== undefined ? nodeOutput : latestEvent ? inferEventOutput(latestEvent.payload) : null,
    diffs: relatedDiffs.length ? relatedDiffs : latestSnapshot?.diff.slice(0, 6) ?? [],
    logs: filterNodeLogs(selectedNodeId, latestEvent, logs),
    metrics: collectStudioNodeMetrics(nodeEvents),
    spans: collectStudioNodeSpans(nodeEvents),
    diagnosis: diagnoseStudioNode(selectedNodeId, flowNode, nodeEvents, latestEvent, errorEvent, latestSnapshot, causalAnalysis),
  };
}

function diagnoseStudioNode(
  nodeId: string,
  flowNode: FlowNode | null,
  nodeEvents: EventView[],
  latestEvent: EventView | null,
  errorEvent: EventView | null,
  latestSnapshot: StudioStateSnapshot | null,
  causalAnalysis: StudioRunCausalAnalysis,
): StudioNodeDiagnosis {
  const profile = buildStudioNodeDiagnosisProfile(flowNode, nodeId);
  if (!latestEvent) {
    return {
      severity: "warning",
      title: "Sem execução observada",
      probableCause: profile.noExecutionCause,
      nextActions: profile.noExecutionActions,
      evidence: [],
    };
  }

  const eventForDiagnosis = errorEvent ?? latestEvent;
  const payload = eventForDiagnosis.payload;
  const reason = readStudioFailureReason(payload);
  const evidence = buildStudioDiagnosisEvidence(nodeEvents, eventForDiagnosis, latestSnapshot, causalAnalysis);
  const safety = isRecord(payload.safety) ? payload.safety : null;
  const isSafetyBlock = safety?.blocked === true || reason.toLowerCase().includes("safety");

  if (errorEvent || isStudioErrorEvent(eventForDiagnosis)) {
    const safetyStage = flowNode?.type === "safety_gate" && typeof flowNode.stage === "string" ? flowNode.stage : "";
    return {
      severity: "error",
      title: "Falha no nó",
      probableCause: isSafetyBlock
        ? `O gate de safety bloqueou a execução${reason ? `: ${reason}` : "."}${safetyStage ? ` Etapa do nó: ${safetyStage}.` : ""}`
        : `${profile.failureCause}${reason ? `: ${reason}` : ` O evento ${eventForDiagnosis.event_type} marcou erro sem mensagem detalhada.`}`,
      nextActions: isSafetyBlock
        ? [
            "Revise a mensagem de entrada ou o cenário que acionou o bloqueio.",
            flowNode?.type === "safety_gate"
              ? "Confira stage, critérios e arestas de bloqueio/allow deste gate de safety."
              : "Abra o payload bruto para conferir safety.blocked, reason e fase.",
            "Crie um fork do checkpoint para reexecutar a mesma entrada após ajustar o flow.",
          ]
        : profile.failureActions,
      evidence,
    };
  }

  if (causalAnalysis.failedNode === nodeId) {
    return {
      severity: "error",
      title: "Origem da falha",
      probableCause: "Este nó foi identificado como o primeiro ponto da cadeia causal com falha.",
      nextActions: [
        "Abra o evento marcado como falha na timeline.",
        "Compare input/output deste nó com um run saudável.",
        "Crie um fork do checkpoint para validar a correção com o mesmo input.",
      ],
      evidence,
    };
  }

  if (causalAnalysis.impactedNodes.includes(nodeId)) {
    return {
      severity: "warning",
      title: "Impactado por falha upstream",
      probableCause: `Este nó aparece depois de ${causalAnalysis.failedNode ?? "um nó upstream"} na cadeia de impacto; o comportamento atual pode ser consequência da falha anterior.`,
      nextActions: [
        "Abra o nó de origem da falha antes de alterar este nó.",
        "Confira se este nó deveria ter sido pulado, bloqueado ou compensado.",
        "Use a comparação de runs para confirmar se o impacto se repete.",
      ],
      evidence,
    };
  }

  if (causalAnalysis.upstreamPath.includes(nodeId)) {
    return {
      severity: "warning",
      title: "Upstream da falha",
      probableCause: "Este nó executou antes da falha e pode ter produzido estado ou output usado pelo nó que falhou.",
      nextActions: [
        "Verifique se o output deste nó mudou antes da falha.",
        "Compare os diffs de estado com um run sem erro.",
        "Se o output estiver correto, siga para o próximo nó da cadeia causal.",
      ],
      evidence,
    };
  }

  return {
    severity: "ok",
    title: "Sem falha associada",
    probableCause: profile.okCause,
    nextActions: profile.okActions,
    evidence,
  };
}

function findStudioFlowNode(flow: AgentFlow | null | undefined, nodeId: string): FlowNode | null {
  if (!nodeId) {
    return null;
  }
  return flow?.nodes.find((node) => node.id === nodeId) ?? (nodeId === "start" ? { id: "start", type: "start" } : null);
}

function buildStudioNodeDiagnosisProfile(flowNode: FlowNode | null, nodeId: string): StudioNodeDiagnosisProfile {
  const type = flowNode?.type ?? "runtime";
  const label = nodeTypeOptions.find((option) => option.type === type)?.label ?? type;
  const commonNoExecutionActions = [
    "Execute um cenário que passe por este nó.",
    "Confira as condições das arestas de entrada no canvas.",
    "Remova filtros da timeline se a execução já deveria estar visível.",
  ];
  const commonFailureActions = [
    "Abra o payload bruto e os logs correlacionados para ver a mensagem de erro.",
    "Confira configuração, entrada, saída esperada e dependências do nó.",
    "Crie um fork do checkpoint para reproduzir a falha em uma nova sessão.",
  ];
  const commonOkActions = [
    "Use input/output e diffs para validar se o comportamento esperado foi produzido.",
    "Compare com outro run se houver suspeita de regressão.",
    "Crie um fork se quiser transformar este estado em cenário reexecutável.",
  ];

  const base: StudioNodeDiagnosisProfile = {
    label,
    noExecutionCause: `Este nó ${label} ainda não apareceu na timeline carregada, então o Studio não tem payload, estado ou diffs para explicar.`,
    noExecutionActions: commonNoExecutionActions,
    failureCause: `O nó ${label} falhou durante a execução.`,
    failureActions: commonFailureActions,
    okCause: `O nó ${label} não indica erro e não está na cadeia causal de falha atual.`,
    okActions: commonOkActions,
  };

  switch (type) {
    case "llm_prompt":
    case "llm_structured":
      return {
        ...base,
        noExecutionCause: `O nó LLM ${nodeId} ainda não recebeu uma entrada nesta run; o prompt renderizado, usage e resposta bruta só aparecem após a chamada.`,
        noExecutionActions: [
          "Execute um cenário que chegue ao prompt deste nó.",
          "Confira promptId, variáveis de prompt e arestas de entrada.",
          "Verifique adapter/modelo e env vars se a chamada deveria ter acontecido.",
        ],
        failureCause: "O nó LLM falhou ao renderizar prompt, chamar o adapter/modelo ou validar a resposta estruturada.",
        failureActions: [
          "Abra Prompt renderizado para conferir variáveis ausentes e conteúdo final.",
          "Confira adapter, modelo, env vars, schema de saída e payload bruto da chamada.",
          "Use o fork do checkpoint para repetir a mesma entrada depois do ajuste.",
        ],
        okCause: "O nó LLM completou sem erro aparente; valide prompt, resposta, usage, custo e diffs antes de aprovar o comportamento.",
        okActions: [
          "Revise Prompt renderizado, input/output e spans estruturados.",
          "Compare tokens, custo e duração com um run de referência.",
          "Crie cenário se essa resposta precisar virar regressão protegida.",
        ],
      };
    case "safety_gate":
      return {
        ...base,
        noExecutionCause: `O gate de safety ${nodeId} ainda não avaliou payload nesta run.`,
        noExecutionActions: [
          "Execute uma entrada que passe pela etapa de safety.",
          "Confira stage, arestas de allow/block e estado usado pela condição.",
          "Teste também um cenário permitido e um bloqueado.",
        ],
        failureCause: "O gate de safety bloqueou ou falhou ao avaliar o payload recebido.",
        failureActions: [
          "Confira safety.blocked, reason, stage e payload avaliado.",
          "Revise as arestas de allow/block para evitar rota incorreta.",
          "Transforme o caso em cenário para validar a política depois do ajuste.",
        ],
        okCause: "O gate de safety avaliou o payload sem erro; confirme se a decisão allow/block segue a política esperada.",
        okActions: [
          "Revise payload bruto e estado safety gravado.",
          "Compare a decisão com um cenário oposto permitido/bloqueado.",
          "Confira se a próxima aresta usada corresponde à decisão.",
        ],
      };
    case "code":
      return {
        ...base,
        noExecutionCause: `O nó Code ${nodeId} ainda não executou arquivo, inline code ou handler nesta run.`,
        noExecutionActions: [
          "Execute um cenário que chegue ao nó de código.",
          "Confira linguagem, entry point, codePath/inline e inputPath.",
          "Valide se dependências declaradas estão no contrato do nó.",
        ],
        failureCause: "O nó Code falhou por erro de runtime, entry point, dependência, inputPath/outputPath ou contrato de saída.",
        failureActions: [
          "Abra logs correlacionados e payload bruto para ver exceção/stack trace.",
          "Confira codeLanguage, codeExecution, codeEntry, codePath e dependências.",
          "Reexecute por fork depois de validar input/output esperados.",
        ],
        okCause: "O nó Code executou sem erro aparente; confirme se o output gravado no estado corresponde ao contrato esperado.",
        okActions: [
          "Confira output, diffs e logs do nó.",
          "Valide se o código customizado está coberto pelo hash de aprovação.",
          "Crie cenário para proteger transformações ou integrações críticas.",
        ],
      };
    case "http_request":
      return {
        ...base,
        noExecutionCause: `A chamada HTTP ${nodeId} ainda não foi disparada nesta run.`,
        noExecutionActions: [
          "Execute um cenário que chegue à integração HTTP.",
          "Confira método, URL, bodyPath, responsePath e timeout.",
          "Use mock://echo quando quiser validar o contrato sem rede externa.",
        ],
        failureCause: "A integração HTTP falhou por URL/método, timeout, status remoto, payload de entrada ou parsing de resposta.",
        failureActions: [
          "Confira method, url, bodyPath, responsePath e timeoutSeconds.",
          "Abra payload bruto para ver status, corpo e erro retornado.",
          "Troque para mock ou cenário fixo antes de aprovar fluxo dependente de rede.",
        ],
        okCause: "A chamada HTTP completou sem erro aparente; valide status, corpo retornado e caminho onde a resposta foi salva.",
        okActions: [
          "Revise input/output, status e responsePath.",
          "Confirme redaction de dados sensíveis antes de exportar logs.",
          "Compare com cenário mockado se a API externa for instável.",
        ],
      };
    case "database_query":
    case "database_save":
      return {
        ...base,
        noExecutionCause: `O nó de banco ${nodeId} ainda não consultou ou gravou dados nesta run.`,
        noExecutionActions: [
          "Execute um cenário que chegue ao acesso de banco.",
          "Confira table, query/dataPath/paramsPath e resultPath.",
          "Verifique se o runtime local está com banco disponível.",
        ],
        failureCause: "O nó de banco falhou por query/tabela/parâmetros inválidos, indisponibilidade do banco ou contrato de resultado.",
        failureActions: [
          "Confira table, query, paramsPath/dataPath, maxRows e resultPath.",
          "Abra logs do sandbox/runtime para ver erro SQL ou conexão.",
          "Use cenário com payload mínimo para isolar schema versus dados.",
        ],
        okCause: "O nó de banco completou sem erro aparente; valide linhas afetadas/retornadas e diffs do estado.",
        okActions: [
          "Revise output, resultPath e diffs gravados.",
          "Confirme idempotência ou duplicação quando a operação for mutável.",
          "Compare com outro run para detectar dados dependentes de ambiente.",
        ],
      };
    case "file_extract":
    case "rag_retrieval":
      return {
        ...base,
        noExecutionCause: `O nó ${label} ainda não processou arquivo, coleção ou consulta nesta run.`,
        noExecutionActions: [
          "Execute um cenário com arquivo/consulta disponível.",
          "Confira sourcePath/contentPath/collectionPath/queryPath e limites de tamanho.",
          "Valide se os assets necessários entram no pacote gerado.",
        ],
        failureCause: "O nó de arquivo/RAG falhou por asset ausente, formato não suportado, consulta vazia ou limite de extração/busca.",
        failureActions: [
          "Confira caminhos configurados, assets em files/ e payload de consulta.",
          "Abra payload bruto para ver erro de extração, chunking ou busca.",
          "Crie cenário com documento pequeno para validar o contrato primeiro.",
        ],
        okCause: "O nó de arquivo/RAG completou sem erro aparente; valide texto extraído, trechos recuperados e contexto entregue ao próximo nó.",
        okActions: [
          "Revise output, contextPath/resultPath e topK/chunkSize.",
          "Compare trechos recuperados com o documento original.",
          "Crie cenário fixo para evitar regressão de recuperação.",
        ],
      };
    case "approval_gate":
      return {
        ...base,
        noExecutionCause: `O approval gate ${nodeId} ainda não avaliou decisão humana ou campo de aprovação nesta run.`,
        noExecutionActions: [
          "Execute um cenário que produza o campo de decisão esperado.",
          "Confira decisionPath, approvalValue e rejectionValue.",
          "Teste explicitamente caminhos aprovado e rejeitado.",
        ],
        failureCause: "O approval gate falhou porque a decisão esperada não foi encontrada ou não bateu com os valores configurados.",
        failureActions: [
          "Confira decisionPath, approvalValue, rejectionValue e output do nó anterior.",
          "Abra state inspector para ver onde a decisão foi gravada.",
          "Crie cenários separados para aprovado, rejeitado e ausente.",
        ],
        okCause: "O approval gate avaliou a decisão sem erro aparente; confirme se a rota tomada corresponde ao valor configurado.",
        okActions: [
          "Revise decisionPath e a próxima aresta executada.",
          "Compare runs aprovado/rejeitado.",
          "Fixe o cenário se aprovação humana for crítica para o runtime final.",
        ],
      };
    case "scoring":
    case "analytics":
      return {
        ...base,
        noExecutionCause: `O nó ${label} ainda não calculou métrica ou evento analítico nesta run.`,
        noExecutionActions: [
          "Execute um cenário que gere o payload de métrica.",
          "Confira payloadPath, metricName, threshold e resultPath.",
          "Valide se os campos usados existem no state inspector.",
        ],
        failureCause: "O nó de scoring/analytics falhou por payload ausente, métrica inválida, threshold incompatível ou resultPath incorreto.",
        failureActions: [
          "Confira payloadPath, metricName, threshold e resultPath.",
          "Abra state inspector para confirmar os campos usados no cálculo.",
          "Compare com cenário de borda abaixo/acima do threshold.",
        ],
        okCause: "O nó de scoring/analytics completou sem erro aparente; valide métrica calculada, threshold e evento registrado.",
        okActions: [
          "Revise output, métricas e diffs.",
          "Compare com cenário de borda para validar o threshold.",
          "Use a comparação de runs para detectar alteração de score.",
        ],
      };
    case "switch":
      return {
        ...base,
        noExecutionCause: `O switch ${nodeId} ainda não avaliou condições nesta run.`,
        failureCause: "O switch falhou ou roteou de forma inesperada por condição, campo de estado ou ordem de arestas.",
        failureActions: [
          "Confira as condições das arestas de saída e o state usado por elas.",
          "Abra diffs anteriores para ver se o campo esperado foi gravado.",
          "Crie cenários para cada rota principal do switch.",
        ],
        okCause: "O switch avaliou condições sem erro aparente; confirme se a aresta escolhida é a rota esperada.",
      };
    case "human_input":
      return {
        ...base,
        noExecutionCause: `O nó humano ${nodeId} ainda não recebeu mensagem nesta run.`,
        failureCause: "O nó humano falhou por ausência de mensagem, payload inválido ou estado de sessão incompatível.",
        okCause: "O nó humano recebeu input sem erro aparente; valide transcript e campos gravados no estado.",
      };
    default:
      return base;
  }
}

function readStudioFailureReason(payload: Record<string, unknown>): string {
  const safety = isRecord(payload.safety) ? payload.safety : null;
  const custom = isRecord(payload.custom) ? payload.custom : null;
  for (const source of [payload, safety, custom]) {
    if (!source) {
      continue;
    }
    for (const key of ["reason", "error", "message", "detail", "blocked_reason", "failure", "exception"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "";
}

function buildStudioDiagnosisEvidence(
  nodeEvents: EventView[],
  event: EventView,
  latestSnapshot: StudioStateSnapshot | null,
  causalAnalysis: StudioRunCausalAnalysis,
): string[] {
  const evidence = [
    `evento #${event.seq}`,
    event.event_type,
  ];
  if (typeof event.payload.status === "string") {
    evidence.push(`status: ${event.payload.status}`);
  }
  if (typeof event.payload.phase === "string") {
    evidence.push(`fase: ${event.payload.phase}`);
  }
  if (latestSnapshot) {
    evidence.push(`snapshot #${latestSnapshot.seq}`);
  }
  if (causalAnalysis.failedEventSeq !== null) {
    evidence.push(`falha #${causalAnalysis.failedEventSeq}`);
  }
  evidence.push(`${nodeEvents.length} evento(s) do nó`);
  return Array.from(new Set(evidence));
}

function isLlmLikeNode(node: FlowNode): boolean {
  return node.type.startsWith("llm_") || Boolean(node.promptId) || Boolean(node.llm);
}

function formatLlmContextValue(llm: Record<string, unknown> | null, key: "adapter" | "model"): string {
  const value = llm?.[key];
  return typeof value === "string" && value.trim() ? value : "-";
}

function buildRenderedPromptPreview(
  prompt: AgentFlow["prompts"][number],
  promptContent: string,
  context: StudioNodeDebugContext,
  session: SessionView | null,
  transcript: MessageView[],
): RenderedPromptPreview {
  const latestPayload = context.latestEvent?.payload ?? {};
  const lastUserMessage = [...transcript].reverse().find((message) => message.role === "user") ?? null;
  const variableValues: Record<string, unknown> = {
    session_id: session?.session_id ?? latestPayload.session_id ?? null,
    turn: session?.turn ?? latestPayload.turn ?? null,
    max_turns: session?.max_turns ?? latestPayload.max_turns ?? null,
    user_message: lastUserMessage?.content ?? null,
    recent_messages: transcript.slice(-6).map((message) => ({
      role: message.role,
      code: message.code ?? null,
      content: message.content,
    })),
    node_input: context.input,
    node_output: context.output,
  };
  const scopedVariables = Object.fromEntries(
    prompt.variables.map((name) => [name, Object.prototype.hasOwnProperty.call(variableValues, name) ? variableValues[name] : null]),
  );
  const missingVariables = prompt.variables.filter((name) => scopedVariables[name] === null || scopedVariables[name] === undefined);
  const rendered = renderPromptTemplate(promptContent.trim(), scopedVariables);

  return {
    promptId: prompt.id,
    path: prompt.path,
    version: prompt.version,
    content: rendered || null,
    variables: scopedVariables,
    missingVariables,
  };
}

function renderPromptTemplate(content: string, variables: Record<string, unknown>): string {
  if (!content) {
    return "";
  }
  let rendered = content;
  for (const [name, value] of Object.entries(variables)) {
    const replacement = renderPromptVariable(value);
    rendered = rendered
      .replaceAll(`{{${name}}}`, replacement)
      .replaceAll(`{{ ${name} }}`, replacement)
      .replaceAll(`{${name}}`, replacement);
  }
  return rendered;
}

function renderPromptVariable(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function collectStudioNodeMetrics(events: EventView[]): StudioNodeMetric[] {
  const metrics = new Map<string, StudioNodeMetric>();
  const upsert = (label: string, value: unknown, detail: string, kind: "number" | "duration" | "cost" | "text" = "text") => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    const formatted = formatStudioMetricValue(value, kind);
    if (formatted === null) {
      return;
    }
    metrics.set(label, { label, value: formatted, detail });
  };

  for (const event of events) {
    const payload = event.payload;
    const detail = `evento #${event.seq}`;
    upsert("status", payload.status, detail);
    upsert("fase", payload.phase, detail);
    upsert("modelo", readFirstString(payload, ["model", "modelName", "model_name"]), detail);
    upsert("provider", readFirstString(payload, ["provider", "adapter"]), detail);
    upsert("duration_ms", readFirstNumber(payload, ["durationMs", "duration_ms", "latencyMs", "latency_ms", "elapsedMs"]), detail, "duration");
    collectUsageMetrics(metrics, payload.usage, detail);
    collectUsageMetrics(metrics, isRecord(payload.llm) ? payload.llm.usage : undefined, detail);
    collectUsageMetrics(metrics, isRecord(payload.custom) ? payload.custom.usage : undefined, detail);
    collectCostMetrics(metrics, payload.cost, detail);
    collectCostMetrics(metrics, isRecord(payload.llm) ? payload.llm.cost : undefined, detail);
    collectCostMetrics(metrics, isRecord(payload.custom) ? payload.custom.cost : undefined, detail);
    upsert("total_tokens", readFirstNumber(payload, ["totalTokens", "total_tokens", "tokens"]), detail, "number");
    upsert("cost_usd", readFirstNumber(payload, ["costUsd", "cost_usd", "totalCostUsd", "total_cost_usd"]), detail, "cost");
  }

  return Array.from(metrics.values());
}

function collectUsageMetrics(metrics: Map<string, StudioNodeMetric>, usage: unknown, detail: string): void {
  if (!isRecord(usage)) {
    return;
  }
  for (const key of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "input_tokens",
    "output_tokens",
    "cached_tokens",
  ]) {
    const value = usage[key] ?? usage[toCamelCase(key)];
    const formatted = formatStudioMetricValue(value, "number");
    if (formatted !== null) {
      metrics.set(key, { label: key, value: formatted, detail });
    }
  }
}

function collectCostMetrics(metrics: Map<string, StudioNodeMetric>, cost: unknown, detail: string): void {
  if (typeof cost === "number" || typeof cost === "string") {
    const formatted = formatStudioMetricValue(cost, "cost");
    if (formatted !== null) {
      metrics.set("cost_usd", { label: "cost_usd", value: formatted, detail });
    }
    return;
  }
  if (!isRecord(cost)) {
    return;
  }
  for (const key of ["total_usd", "cost_usd", "input_usd", "output_usd"]) {
    const value = cost[key] ?? cost[toCamelCase(key)];
    const formatted = formatStudioMetricValue(value, "cost");
    if (formatted !== null) {
      metrics.set(key, { label: key, value: formatted, detail });
    }
  }
}

function collectStudioNodeSpans(events: EventView[]): StudioNodeSpan[] {
  const spans: StudioNodeSpan[] = [];
  for (const event of events) {
    const candidates = collectSpanCandidates(event.payload);
    for (const candidate of candidates) {
      spans.push({
        name: readFirstString(candidate, ["name", "span", "operation", "type"]) ?? event.event_type,
        status: readFirstString(candidate, ["status", "result", "outcome"]) ?? readFirstString(event.payload, ["status"]) ?? "-",
        durationMs: readFirstNumber(candidate, ["durationMs", "duration_ms", "latencyMs", "latency_ms", "elapsedMs"]),
        tokens: readSpanTokens(candidate),
        cost: readSpanCost(candidate),
        eventSeq: event.seq,
      });
    }
  }
  return spans;
}

function collectSpanCandidates(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  appendSpanCandidate(candidates, payload.span);
  appendSpanCandidate(candidates, payload.spans);
  if (isRecord(payload.custom)) {
    appendSpanCandidate(candidates, payload.custom.span);
    appendSpanCandidate(candidates, payload.custom.spans);
  }
  if (isRecord(payload.llm)) {
    appendSpanCandidate(candidates, payload.llm.span);
    appendSpanCandidate(candidates, payload.llm.spans);
  }
  return candidates;
}

function appendSpanCandidate(target: Record<string, unknown>[], value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) {
        target.push(item);
      }
    }
    return;
  }
  if (isRecord(value)) {
    target.push(value);
  }
}

function readSpanTokens(span: Record<string, unknown>): number | null {
  const direct = readFirstNumber(span, ["tokens", "totalTokens", "total_tokens", "inputTokens", "outputTokens"]);
  if (direct !== null) {
    return direct;
  }
  if (isRecord(span.usage)) {
    return readFirstNumber(span.usage, ["total_tokens", "totalTokens", "tokens"]);
  }
  return null;
}

function readSpanCost(span: Record<string, unknown>): string | null {
  const direct = readFirstNumber(span, ["costUsd", "cost_usd", "totalUsd", "total_usd"]);
  if (direct !== null) {
    return formatStudioMetricValue(direct, "cost");
  }
  if (typeof span.cost === "number" || typeof span.cost === "string" || isRecord(span.cost)) {
    if (isRecord(span.cost)) {
      return formatStudioMetricValue(readFirstNumber(span.cost, ["total_usd", "cost_usd", "totalUsd", "costUsd"]), "cost");
    }
    return formatStudioMetricValue(span.cost, "cost");
  }
  return null;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function readFirstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function formatStudioMetricValue(value: unknown, kind: "number" | "duration" | "cost" | "text"): string | null {
  if (kind === "duration") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? formatRunDuration(numberValue) : null;
  }
  if (kind === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? String(Math.round(numberValue)) : null;
  }
  if (kind === "cost") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? `$${numberValue.toFixed(6)}` : null;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function snapshotHasNode(snapshot: StudioStateSnapshot, nodeId: string): boolean {
  const nodes = snapshot.state.nodes;
  return isRecord(nodes) && nodeId in nodes;
}

function readSnapshotNodeState(snapshot: StudioStateSnapshot, nodeId: string): unknown {
  const nodes = snapshot.state.nodes;
  return isRecord(nodes) ? nodes[nodeId] ?? null : null;
}

function readSnapshotNodeOutput(snapshot: StudioStateSnapshot, nodeId: string): unknown {
  const outputs = snapshot.state.outputs;
  return isRecord(outputs) ? outputs[nodeId] : undefined;
}

function isNodeRelatedDiff(pathName: string, nodeId: string): boolean {
  return pathName === `nodes.${nodeId}` ||
    pathName.startsWith(`nodes.${nodeId}.`) ||
    pathName === `outputs.${nodeId}` ||
    pathName.startsWith(`outputs.${nodeId}.`) ||
    pathName === "current.node";
}

function readNodeContextStatus(event: EventView | null, snapshot: StudioStateSnapshot | null): string {
  if (!event) {
    return "sem evento";
  }
  if (isStudioErrorEvent(event)) {
    return "error";
  }
  if (typeof event.payload.status === "string" && event.payload.status.trim()) {
    return event.payload.status;
  }
  return snapshot?.status ?? "observado";
}

function readNodeCausalRole(nodeId: string, causalAnalysis: StudioRunCausalAnalysis): string {
  if (causalAnalysis.failedNode === nodeId) {
    return "origem da falha";
  }
  if (causalAnalysis.upstreamPath.includes(nodeId)) {
    return "upstream";
  }
  if (causalAnalysis.impactedNodes.includes(nodeId)) {
    return "impactado";
  }
  return "fora da cadeia";
}

function nodeContextStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("blocked")) {
    return "runtime-pill stopped";
  }
  if (normalized.includes("success") || normalized.includes("ok") || normalized.includes("complete")) {
    return "runtime-pill running";
  }
  return "runtime-pill";
}

function filterNodeLogs(nodeId: string, latestEvent: EventView | null, logs: string[]): string[] {
  const eventType = latestEvent?.event_type.toLowerCase();
  const node = nodeId.toLowerCase();
  const matched = logs.filter((line) => {
    const lower = line.toLowerCase();
    return lower.includes(node) || (eventType ? lower.includes(eventType) : false);
  });
  return (matched.length ? matched : logs).slice(-6);
}

type StudioNodeExecutionStatus = "queued" | "running" | "success" | "error" | "skipped" | "blocked";

interface StudioNodeExecutionState {
  status: StudioNodeExecutionStatus;
  seq: number;
  eventType: string;
}

function inferNodeExecutionStates(events: EventView[]): Map<string, StudioNodeExecutionState> {
  const byNode = new Map<string, StudioNodeExecutionState>();
  for (const event of events) {
    if (!event.node) {
      continue;
    }
    const eventType = event.event_type.toLowerCase();
    const payloadStatus = typeof event.payload.status === "string" ? event.payload.status.toLowerCase() : undefined;

    let next: StudioNodeExecutionStatus;
    if (eventType.includes("error") || eventType.includes("failed") || payloadStatus === "error") {
      next = "error";
    } else if (eventType.includes("blocked") || eventType.includes("block") || payloadStatus === "blocked") {
      next = "blocked";
    } else if (
      eventType.includes("skip") ||
      eventType.includes("skipped") ||
      eventType.includes("bypass") ||
      payloadStatus === "skipped" ||
      payloadStatus === "skipped_by_condition"
    ) {
      next = "skipped";
    } else if (
      eventType.includes("completed") ||
      eventType.includes("success") ||
      eventType.includes("done") ||
      payloadStatus === "ok" ||
      payloadStatus === "success"
    ) {
      next = "success";
    } else if (
      eventType.includes("start") ||
      eventType.includes("started") ||
      eventType.includes("running") ||
      eventType.includes("enter") ||
      eventType.includes("emit")
    ) {
      next = "running";
    } else {
      next = "queued";
    }

    byNode.set(event.node, {
      status: next,
      seq: event.seq,
      eventType,
    });
  }
  return byNode;
}

function inferEdgeExecutionStatus(
  edge: FlowEdge,
  nodeStates: Map<string, StudioNodeExecutionState>,
): StudioNodeExecutionStatus | "idle" {
  const fromState = nodeStates.get(edge.from);
  const toState = nodeStates.get(edge.to);
  if (fromState?.status === "error" || toState?.status === "error") {
    return "error";
  }
  if (fromState?.status === "blocked" || toState?.status === "blocked") {
    return "blocked";
  }
  if (fromState?.status === "skipped" || toState?.status === "skipped") {
    return "skipped";
  }
  if (fromState?.status === "running" || toState?.status === "running") {
    return "running";
  }
  if (fromState?.status === "success" && toState?.status === "success") {
    return "success";
  }
  if (fromState?.status === "queued" || toState?.status === "queued") {
    return "queued";
  }
  return "idle";
}

interface FlowTopology {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

function buildStudioRunCausalAnalysis(
  flow: AgentFlow | null,
  events: EventView[],
): StudioRunCausalAnalysis {
  if (!events.length) {
    return emptyStudioRunCausalAnalysis();
  }
  const orderedEvents = [...events].sort((left, right) => left.seq - right.seq);
  const latestFailure = orderedEvents.filter(isStudioErrorEvent).at(-1);
  if (!latestFailure) {
    return emptyStudioRunCausalAnalysis();
  }
  const failedNode = latestFailure.node ?? null;
  if (!flow || !failedNode) {
    return {
      failedEventSeq: latestFailure.seq,
      failedEventType: latestFailure.event_type,
      failedNode: null,
      upstreamPath: [],
      impactPath: [],
      impactedNodes: [],
    };
  }
  const topology = buildStudioFlowTopology(flow);
  const eventSeqIndex = buildStudioFailureExecutionIndex(orderedEvents, latestFailure.seq);
  const downstreamImpact = buildStudioDownstreamImpactIndex(
    topology,
    failedNode,
    latestFailure.seq,
    eventSeqIndex.firstAfterFailure,
  );
  return {
    failedEventSeq: latestFailure.seq,
    failedEventType: latestFailure.event_type,
    failedNode,
    upstreamPath: deriveStudioUpstreamPath(topology, failedNode, latestFailure.seq, eventSeqIndex.lastBeforeFailure),
    impactPath: deriveStudioImpactPath(topology, failedNode, downstreamImpact),
    impactedNodes: deriveStudioImpactedNodeOrder(topology, failedNode, downstreamImpact),
  };
}

function emptyStudioRunCausalAnalysis(): StudioRunCausalAnalysis {
  return {
    failedEventSeq: null,
    failedEventType: null,
    failedNode: null,
    upstreamPath: [],
    impactPath: [],
    impactedNodes: [],
  };
}

function buildStudioFlowTopology(flow: AgentFlow): FlowTopology {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const from = String(edge.from);
    const to = String(edge.to);
    const outgoingList = outgoing.get(from) ?? [];
    outgoingList.push(to);
    outgoing.set(from, outgoingList);
    const incomingList = incoming.get(to) ?? [];
    incomingList.push(from);
    incoming.set(to, incomingList);
  }
  return { outgoing, incoming };
}

function buildStudioFailureExecutionIndex(
  events: EventView[],
  failedEventSeq: number,
): {
  lastBeforeFailure: Map<string, number>;
  firstAfterFailure: Map<string, number>;
} {
  const lastBeforeFailure = new Map<string, number>();
  const firstAfterFailure = new Map<string, number>();
  for (const event of events) {
    if (!event.node) {
      continue;
    }
    if (event.seq < failedEventSeq) {
      lastBeforeFailure.set(event.node, event.seq);
    }
    if (event.seq > failedEventSeq && !firstAfterFailure.has(event.node)) {
      firstAfterFailure.set(event.node, event.seq);
    }
  }
  return { lastBeforeFailure, firstAfterFailure };
}

function buildStudioDownstreamImpactIndex(
  topology: FlowTopology,
  failedNode: string,
  failedEventSeq: number,
  firstAfterFailure: Map<string, number>,
): Map<string, number> {
  const earliestPostFailure = new Map<string, number>();
  const memo = new Map<string, number | null>();
  const visiting = new Set<string>();

  const dfs = (node: string): number | null => {
    const cached = memo.get(node);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(node)) {
      return null;
    }
    visiting.add(node);

    const directSeq = firstAfterFailure.get(node);
    if (directSeq !== undefined) {
      memo.set(node, directSeq);
      visiting.delete(node);
      return directSeq;
    }

    let best: number | null = null;
    for (const child of topology.outgoing.get(node) ?? []) {
      const candidate = dfs(child);
      if (candidate !== null && (best === null || candidate < best)) {
        best = candidate;
      }
    }
    memo.set(node, best);
    visiting.delete(node);
    return best;
  };

  dfs(failedNode);
  const stack = [failedNode];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (dfs(current) === null) {
      continue;
    }
    for (const child of topology.outgoing.get(current) ?? []) {
      const childImpact = dfs(child);
      if (childImpact !== null && !earliestPostFailure.has(child)) {
        earliestPostFailure.set(child, childImpact);
        stack.push(child);
      }
    }
  }
  earliestPostFailure.set(failedNode, earliestPostFailure.get(failedNode) ?? failedEventSeq);
  return earliestPostFailure;
}

function deriveStudioUpstreamPath(
  topology: FlowTopology,
  node: string,
  failureSeq: number,
  lastByNodeBeforeFailure: Map<string, number>,
): string[] {
  const visited = new Set<string>();
  const path: string[] = [node];
  let current = node;
  visited.add(current);
  while (true) {
    const parents = topology.incoming.get(current);
    let next: string | undefined;
    for (const parent of parents ?? []) {
      const parentSeq = lastByNodeBeforeFailure.get(parent);
      if (parentSeq === undefined || parentSeq >= failureSeq || visited.has(parent)) {
        continue;
      }
      if (!next) {
        next = parent;
        continue;
      }
      const nextSeq = lastByNodeBeforeFailure.get(next);
      if (nextSeq !== undefined && parentSeq > nextSeq) {
        next = parent;
      }
    }
    if (!next) {
      return path.slice().reverse();
    }
    visited.add(next);
    path.push(next);
    current = next;
  }
}

function deriveStudioImpactPath(
  topology: FlowTopology,
  node: string,
  downstreamImpactByNode: Map<string, number>,
): string[] {
  const visited = new Set<string>([node]);
  const path: string[] = [node];
  let current = node;
  while (true) {
    const next = (topology.outgoing.get(current) ?? [])
      .filter((child) => !visited.has(child) && downstreamImpactByNode.has(child))
      .sort((left, right) => {
        const leftSeq = downstreamImpactByNode.get(left) ?? Number.POSITIVE_INFINITY;
        const rightSeq = downstreamImpactByNode.get(right) ?? Number.POSITIVE_INFINITY;
        return leftSeq - rightSeq || left.localeCompare(right);
      })[0];
    if (!next) {
      return path;
    }
    visited.add(next);
    path.push(next);
    current = next;
  }
}

function deriveStudioImpactedNodes(
  topology: FlowTopology,
  failedNode: string,
  downstreamImpactByNode: Map<string, number>,
): Set<string> {
  const impacted = new Set<string>([failedNode]);
  const stack = [failedNode];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const children = topology.outgoing.get(current);
    if (!children) {
      continue;
    }
    for (const child of children) {
      if (!impacted.has(child) && downstreamImpactByNode.has(child)) {
        impacted.add(child);
        stack.push(child);
      }
    }
  }
  return impacted;
}

function deriveStudioImpactedNodeOrder(
  topology: FlowTopology,
  failedNode: string,
  downstreamImpactByNode: Map<string, number>,
): string[] {
  const impacted = deriveStudioImpactedNodes(topology, failedNode, downstreamImpactByNode);
  const ordered: string[] = [];
  const visited = new Set<string>();
  const stack = [failedNode];
  while (stack.length) {
    const current = stack.shift();
    if (!current || visited.has(current) || !impacted.has(current)) {
      continue;
    }
    visited.add(current);
    ordered.push(current);
    const children = (topology.outgoing.get(current) ?? [])
      .filter((child) => impacted.has(child) && !visited.has(child))
      .sort((left, right) => {
        const leftSeq = downstreamImpactByNode.get(left) ?? Number.POSITIVE_INFINITY;
        const rightSeq = downstreamImpactByNode.get(right) ?? Number.POSITIVE_INFINITY;
        return leftSeq - rightSeq || left.localeCompare(right);
      });
    stack.push(...children);
  }
  for (const node of impacted) {
    if (!visited.has(node)) {
      ordered.push(node);
    }
  }
  return ordered;
}

function isStudioErrorEvent(event: EventView): boolean {
  const type = event.event_type.toLowerCase();
  if (type.includes("error") || type.includes("failed")) {
    return true;
  }
  return typeof event.payload.status === "string" && ["error", "failed"].includes(event.payload.status.toLowerCase());
}

function studioEventCausalClass(event: EventView, causalAnalysis: StudioRunCausalAnalysis): string {
  if (!event.node) {
    return "";
  }
  if (event.seq === causalAnalysis.failedEventSeq) {
    return "timeline-item-causal-origin";
  }
  if (causalAnalysis.upstreamPath.includes(event.node) && event.seq <= (causalAnalysis.failedEventSeq ?? Number.NEGATIVE_INFINITY)) {
    return "timeline-item-causal-upstream";
  }
  if (causalAnalysis.impactedNodes.includes(event.node)) {
    return "timeline-item-causal-impact";
  }
  return "";
}

function toReactFlowGraph(
  flow: AgentFlow | undefined,
  selectedNodeId: string,
  selectedEdgeId: string,
  events: EventView[],
  activeStudioNodeId: string,
  causalAnalysis: StudioRunCausalAnalysis,
): { nodes: Node[]; edges: Edge[] } {
  if (!flow) {
    return { nodes: [], edges: [] };
  }
  const nodeStates = inferNodeExecutionStates(events);
  const causalOrigin = causalAnalysis.failedNode ?? null;
  const upstreamPathIndex = new Map<string, number>();
  causalAnalysis.upstreamPath.forEach((nodeId, index) => upstreamPathIndex.set(nodeId, index));
  const impactPathIndex = new Map<string, number>();
  causalAnalysis.impactPath.forEach((nodeId, index) => impactPathIndex.set(nodeId, index));
  const nodeIds = ["start", ...flow.nodes.map((node) => node.id), "end"];
  const nodes: Node[] = nodeIds.map((id, index) => {
    const flowNode = flow.nodes.find((node) => node.id === id);
    const isVirtual = isVirtualNodeId(id);
    const nodeState = nodeStates.get(id);
    const isStudioActive = activeStudioNodeId === id;
    const nodeCausalClass = id === causalOrigin
      ? "status-causal-origin"
      : upstreamPathIndex.has(id)
        ? "status-causal-upstream"
        : causalAnalysis.impactedNodes.includes(id)
          ? "status-causal-impact"
          : "";
    return {
      id,
      position: flowNode?.position ?? defaultNodePosition(index),
      data: {
        label: isVirtual ? id.toUpperCase() : id,
        sublabel: flowNode?.type ?? "graph",
      },
      selected: selectedNodeId === id,
      className: `flow-node ${isVirtual ? "virtual" : flowNode?.type ?? ""} ${
        nodeState?.status ? `status-${nodeState.status}` : ""
      } ${nodeCausalClass} ${isStudioActive ? "studio-active" : ""}`.trim(),
      draggable: !isVirtual,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });

  const edges: Edge[] = flow.edges.map((edge, index) => {
    const edgeClass = edge.condition ? "conditional-edge" : "plain-edge";
    const edgeExecution = inferEdgeExecutionStatus(edge, nodeStates);
    const edgeExecutionClass = edgeExecution === "idle" ? "" : `status-${edgeExecution}-edge`;
    const upstreamFrom = upstreamPathIndex.get(edge.from);
    const upstreamTo = upstreamPathIndex.get(edge.to);
    const impactFrom = impactPathIndex.get(edge.from);
    const impactTo = impactPathIndex.get(edge.to);
    const isCausalUpstreamEdge =
      upstreamFrom !== undefined && upstreamTo !== undefined && upstreamTo - upstreamFrom === 1;
    const isCausalImpactEdge = impactFrom !== undefined && impactTo !== undefined && impactTo - impactFrom === 1;
    const isOriginEdge = Boolean(causalOrigin) && edge.to === causalOrigin && upstreamFrom !== undefined && upstreamTo === undefined;
    const causalClass = isOriginEdge
      ? "status-causal-origin-edge"
      : isCausalUpstreamEdge
        ? "status-causal-upstream-edge"
        : isCausalImpactEdge
          ? "status-causal-impact-edge"
          : "";

    return {
      id: edgeId(edge, index),
      source: edge.from,
      target: edge.to,
      label: edge.condition,
      selected: selectedEdgeId === edgeId(edge, index),
      markerEnd: { type: MarkerType.ArrowClosed },
      className: `${edgeClass} ${edgeExecutionClass} ${causalClass}`.trim(),
    };
  });
  return { nodes, edges };
}

function createDefaultNode(flow: AgentFlow, type: string): FlowNode {
  const id = uniqueNodeId(flow, type);
  return applyNodeTypeDefaults(
    {
      id,
      type,
      position: defaultNodePosition(flow.nodes.length + 1),
    },
    flow,
  );
}

function applyNodeTypeDefaults(node: FlowNode, flow: AgentFlow): FlowNode {
  const next: FlowNode = {
    id: node.id,
    type: node.type,
    description: node.description,
    position: node.position,
  };
  if (node.type === "llm_prompt" || node.type === "llm_structured") {
    next.promptId = node.promptId ?? flow.prompts[0]?.id;
    next.outputSchema = node.outputSchema;
    next.llm = node.llm ?? { adapter: flow.llm.adapter, model: flow.llm.model };
  }
  if (node.type === "safety_gate") {
    next.stage = node.stage ?? "input";
  }
  if (node.type === "code") {
    next.handler = node.handler ?? "handler_name";
    next.codeLanguage = node.codeLanguage ?? "python";
    next.codeExecution = node.codeExecution ?? "native";
    next.codePath = node.codePath;
    next.codeEntry = node.codeEntry ?? "run";
    next.codeInline = node.codeInline;
    next.codeDependencies = node.codeDependencies;
    next.inputPath = node.inputPath ?? "state";
    next.resultPath = node.resultPath ?? `custom.${node.id}`;
  }
  if (node.type === "http_request") {
    next.method = node.method ?? "POST";
    next.url = node.url ?? "mock://echo";
    next.bodyPath = node.bodyPath ?? "user_message";
    next.responsePath = node.responsePath ?? `http.${node.id}`;
  }
  if (node.type === "transform_json") {
    next.inputPath = node.inputPath ?? "assistant_message";
    next.outputPath = node.outputPath ?? `transforms.${node.id}`;
  }
  if (node.type === "database_query") {
    next.query = node.query ?? "SELECT record_id, node_id, payload_json FROM agent_node_records WHERE session_id = :session_id ORDER BY created_at DESC";
    next.paramsPath = node.paramsPath ?? "database_params";
    next.resultPath = node.resultPath ?? `database.${node.id}`;
  }
  if (node.type === "database_save") {
    next.table = node.table ?? "agent_node_records";
    next.dataPath = node.dataPath ?? "assistant_message";
    next.resultPath = node.resultPath ?? `database.${node.id}`;
    next.query = node.query;
  }
  if (node.type === "file_extract") {
    next.sourcePath = node.sourcePath ?? "knowledge.md";
    next.contentPath = node.contentPath ?? `files.${node.id}`;
    next.maxChars = node.maxChars ?? 20000;
  }
  if (node.type === "rag_retrieval") {
    next.collectionPath = node.collectionPath ?? ".";
    next.queryPath = node.queryPath ?? "user_message";
    next.contextPath = node.contextPath ?? `rag.${node.id}`;
    next.topK = node.topK ?? 3;
    next.chunkSize = node.chunkSize ?? 900;
  }
  if (node.type === "approval_gate") {
    next.decisionPath = node.decisionPath ?? "approval.decision";
    next.approvalValue = node.approvalValue ?? "approved";
    next.rejectionValue = node.rejectionValue ?? "rejected";
    next.resultPath = node.resultPath ?? `approvals.${node.id}`;
  }
  if (node.type === "scoring") {
    next.inputPath = node.inputPath ?? "assistant_message";
    next.resultPath = node.resultPath ?? `scores.${node.id}`;
    next.threshold = node.threshold ?? 0.7;
  }
  if (node.type === "analytics") {
    next.metricName = node.metricName ?? node.id;
    next.payloadPath = node.payloadPath ?? "scores";
    next.resultPath = node.resultPath ?? `analytics.${node.id}`;
  }
  return next;
}

function uniqueNodeId(flow: AgentFlow, type: string): string {
  const used = new Set(["start", "end", ...flow.nodes.map((node) => node.id)]);
  const base = type.replace(/[^a-zA-Z0-9_-]/g, "_") || "node";
  let index = flow.nodes.length + 1;
  let candidate = `${base}_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

function defaultNodePosition(index: number) {
  return {
    x: index * 230,
    y: index % 2 === 0 ? 140 : 300,
  };
}

function isVirtualNodeId(id: string): boolean {
  return id === "start" || id === "end";
}

function isValidNodeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function edgeId(edge: Pick<FlowEdge, "from" | "to">, index: number): string {
  return `edge-${index}-${edge.from}-${edge.to}`;
}

function edgeIndexFromId(id: string): number {
  const match = /^edge-(\d+)-/.exec(id);
  return match ? Number(match[1]) : -1;
}

function validationMessage(result: ValidationResult): string {
  if (result.summary.errors || result.summary.warnings) {
    return `${result.name}: ${result.summary.errors} erro(s), ${result.summary.warnings} aviso(s).`;
  }
  return `${result.name}: ${result.nodes} nós, ${result.edges} arestas, contrato ${result.contract}.`;
}

function langGraphSandboxMessage(result: GenerateResult): string {
  return `Pacote LangGraph gerado em ${result.outDir}.`;
}

function approvalMessage(approval: LangGraphSandboxApproval): string {
  return `Sandbox aprovado em ${approval.approvalPath} para ${approval.approvedFor}. Hash ${approval.flowHash.slice(0, 12)}.`;
}

function approvedRuntimeMessage(result: ApprovedGenerateResult): string {
  return `API Docker aprovada gerada em ${result.outDir}. Hash ${result.approval.flowHash.slice(0, 12)}.`;
}

function artifactLooksLikeDockerRuntime(listing: GeneratedArtifactListing): boolean {
  const paths = new Set(listing.files.map((file) => file.path));
  return paths.has("Dockerfile") && paths.has("docker-compose.yml") && paths.has(".agent-flow/generated-meta.json");
}

async function runDockerRuntimeOperation(
  operation: DockerRuntimeOperation,
  outDir: string,
  runtimeUrl: string,
): Promise<DockerRuntimeOperationResult> {
  if (operation === "prepare_env") {
    return dockerRuntimePrepareEnv(outDir, runtimeUrl);
  }
  if (operation === "build") {
    return dockerRuntimeBuild(outDir, runtimeUrl);
  }
  if (operation === "cancel") {
    return dockerRuntimeCancel(outDir, runtimeUrl);
  }
  if (operation === "up") {
    return dockerRuntimeUp(outDir, runtimeUrl);
  }
  if (operation === "down") {
    return dockerRuntimeDown(outDir, runtimeUrl);
  }
  if (operation === "inspect") {
    return dockerRuntimeInspect(outDir, runtimeUrl);
  }
  if (operation === "configure_ports") {
    throw new Error("Use a ação de aplicar portas para atualizar o docker-compose.");
  }
  return dockerRuntimeSmoke(outDir, runtimeUrl);
}

function dockerOperationLabel(operation: DockerRuntimeOperation): string {
  if (operation === "prepare_env") {
    return "Preparando .env do runtime final";
  }
  if (operation === "build") {
    return "Build Docker final";
  }
  if (operation === "cancel") {
    return "Cancelando build Docker";
  }
  if (operation === "up") {
    return "Subindo container final";
  }
  if (operation === "down") {
    return "Parando container final";
  }
  if (operation === "inspect") {
    return "Inspecionando container final";
  }
  if (operation === "configure_ports") {
    return "Atualizando portas Docker";
  }
  return "Executando smoke test";
}

function dockerOperationName(operation: DockerRuntimeOperation): string {
  if (operation === "prepare_env") {
    return "Prepare .env";
  }
  if (operation === "build") {
    return "Build";
  }
  if (operation === "cancel") {
    return "Cancel";
  }
  if (operation === "up") {
    return "Up";
  }
  if (operation === "down") {
    return "Down";
  }
  if (operation === "inspect") {
    return "Inspect";
  }
  if (operation === "configure_ports") {
    return "Portas";
  }
  return "Smoke";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function inferCheckpointForkInput(event: EventView, transcript: MessageView[]): string {
  const custom = isRecord(event.payload.custom) ? event.payload.custom : null;
  for (const key of ["user_message", "message", "input", "content", "prompt"]) {
    const value = custom?.[key] ?? event.payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const lastUserMessage = [...transcript].reverse().find((message) => message.role === "user" && message.content.trim());
  return lastUserMessage?.content.trim() ?? `Reexecutar checkpoint ${event.event_type} #${event.seq}`;
}

function latestCheckpointRestoreEvent(events: EventView[]): EventView | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.event_type === "checkpoint_restored") {
      return events[index];
    }
  }
  return null;
}

function restoreEventSourceLabel(source: unknown): string {
  if (source === "checkpointer") {
    return "checkpointer";
  }
  if (source === "metadata" || source === "studio-snapshot" || source === "snapshot") {
    return "snapshot";
  }
  if (typeof source === "string" && source.trim()) {
    return source.trim();
  }
  return "não observado";
}

function restoreStrategyLabel(checkpoint: StudioScenarioCheckpoint | null): string {
  if (!checkpoint) {
    return "sem restore";
  }
  return checkpoint.sourceSessionId ? "checkpointer -> snapshot" : "snapshot";
}

function checkpointStateShape(checkpoint: StudioScenarioCheckpoint | null): string {
  if (!checkpoint || !isRecord(checkpoint.state)) {
    return "snapshot local indisponível";
  }
  const keys = Object.keys(checkpoint.state);
  if (keys.length === 0) {
    return "snapshot vazio";
  }
  const visible = keys.slice(0, 4).join(", ");
  const suffix = keys.length > 4 ? ` +${keys.length - 4}` : "";
  return `estado: ${visible}${suffix}`;
}

function checkpointCompatibilityStatus(
  flow: AgentFlow | null,
  checkpoint: StudioScenarioCheckpoint | null,
  approvalStatus: LangGraphSandboxApprovalStatus | null,
): StudioScenarioCheckpointCompatibilityStatus {
  if (!checkpoint) {
    return { level: "ok", label: "compatibilidade: sem checkpoint", reasons: [] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!checkpoint.sourceSessionId && !isRecord(checkpoint.state)) {
    errors.push("checkpoint sem sessão de origem e sem snapshot local");
  }
  const compatibility = checkpoint.compatibility;
  if (!compatibility) {
    warnings.push("checkpoint legado sem assinatura de versão/hash");
    return errors.length > 0
      ? { level: "error", label: "compatibilidade: incompatível", reasons: errors }
      : { level: "warning", label: "compatibilidade: legado sem hash", reasons: warnings };
  }
  if (!flow) {
    warnings.push("flow atual indisponível para validar hash");
    return errors.length > 0
      ? { level: "error", label: "compatibilidade: incompatível", reasons: errors }
      : { level: "warning", label: "compatibilidade: parcial", reasons: warnings };
  }
  if (compatibility.flowId && compatibility.flowId !== flow.id) {
    errors.push(`flow mudou de ${compatibility.flowId} para ${flow.id}`);
  }
  if (compatibility.flowVersion && compatibility.flowVersion !== flow.version) {
    errors.push(`versão mudou de ${compatibility.flowVersion} para ${flow.version}`);
  }
  const currentFlowHash = hashStudioFlowDefinition(flow);
  if (compatibility.flowHash && compatibility.flowHash !== currentFlowHash) {
    errors.push("hash local do flow mudou");
  } else if (!compatibility.flowHash) {
    warnings.push("checkpoint sem hash local do flow");
  }
  const currentProjectHash = currentStudioProjectHash(flow, approvalStatus);
  if (compatibility.projectHash && currentProjectHash && compatibility.projectHash !== currentProjectHash) {
    errors.push("hash de projeto/assets mudou");
  } else if (compatibility.projectHash && !currentProjectHash) {
    warnings.push("hash de projeto/assets atual indisponível");
  } else if (!compatibility.projectHash && currentProjectHash) {
    warnings.push("checkpoint sem hash de projeto/assets");
  }
  const checkpointNodeId = compatibility.nodeId ?? checkpoint.nodeId;
  if (checkpointNodeId) {
    const currentNode = studioPinNodeForHash(flow, checkpointNodeId);
    if (!currentNode) {
      errors.push(`nó ${checkpointNodeId} não existe mais`);
    } else {
      const currentNodeHash = hashStudioNodeDefinition(currentNode);
      if (compatibility.nodeHash && compatibility.nodeHash !== currentNodeHash) {
        errors.push(`hash do nó ${checkpointNodeId} mudou`);
      } else if (!compatibility.nodeHash) {
        warnings.push(`checkpoint sem hash do nó ${checkpointNodeId}`);
      }
    }
  }
  if (errors.length > 0) {
    return { level: "error", label: "compatibilidade: incompatível", reasons: errors };
  }
  if (warnings.length > 0) {
    return { level: "warning", label: "compatibilidade: parcial", reasons: warnings };
  }
  return {
    level: "ok",
    label: compatibility.projectHash && currentProjectHash
      ? "compatibilidade: versão/hash/projeto atuais"
      : "compatibilidade: versão/hash atuais",
    reasons: [],
  };
}

function buildStudioScenarioCheckpointCompatibility(
  flow: AgentFlow | null,
  nodeId: string | null,
  approvalStatus: LangGraphSandboxApprovalStatus | null,
  checkedAt: string,
): StudioScenarioCheckpointCompatibility | null {
  if (!flow) {
    return null;
  }
  const currentNode = nodeId ? studioPinNodeForHash(flow, nodeId) : null;
  return {
    flowId: flow.id,
    flowVersion: flow.version,
    flowHash: hashStudioFlowDefinition(flow),
    projectHash: currentStudioProjectHash(flow, approvalStatus),
    nodeId,
    nodeHash: currentNode ? hashStudioNodeDefinition(currentNode) : null,
    checkedAt,
  };
}

function currentStudioProjectHash(
  flow: AgentFlow | null,
  approvalStatus: LangGraphSandboxApprovalStatus | null,
): string | null {
  if (!flow || !approvalStatus?.flowHash?.trim()) {
    return null;
  }
  if (approvalStatus.flowId !== flow.id || approvalStatus.flowVersion !== flow.version) {
    return null;
  }
  return approvalStatus.flowHash;
}

function restorePayloadStateKeys(payload: Record<string, unknown> | null): string {
  const keys = payload?.stateKeys;
  if (!Array.isArray(keys)) {
    return "não informado";
  }
  const normalized = keys.filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  if (normalized.length === 0) {
    return "vazio";
  }
  const visible = normalized.slice(0, 4).join(", ");
  const suffix = normalized.length > 4 ? ` +${normalized.length - 4}` : "";
  return `${visible}${suffix}`;
}

function formatRestoreTurn(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "-";
}

function formatRestoreSessionId(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "-";
}

function studioScenarioExecutionMetadata(scenario: StudioScenario, nodePins: StudioNodePin[] = []): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    scenario: {
      id: scenario.id,
      label: scenario.label,
      tags: scenario.tags,
      useNodePins: scenario.useNodePins,
      regressionThresholds: scenario.regressionThresholds,
    },
  };
  if (scenario.checkpoint) {
    metadata.checkpoint = {
      sourceRunId: scenario.checkpoint.sourceRunId,
      sourceSessionId: scenario.checkpoint.sourceSessionId,
      eventSeq: scenario.checkpoint.eventSeq,
      eventType: scenario.checkpoint.eventType,
      nodeId: scenario.checkpoint.nodeId,
      snapshotSeq: scenario.checkpoint.snapshotSeq,
      status: scenario.checkpoint.status,
      phase: scenario.checkpoint.phase,
      turn: scenario.checkpoint.turn,
      compatibility: scenario.checkpoint.compatibility,
      mode: "scenario-fork",
    };
    metadata.restore = {
      mode: "scenario-fork",
      source: "studio-snapshot",
      sourceRunId: scenario.checkpoint.sourceRunId,
      sourceSessionId: scenario.checkpoint.sourceSessionId,
      eventSeq: scenario.checkpoint.eventSeq,
      eventType: scenario.checkpoint.eventType,
      nodeId: scenario.checkpoint.nodeId,
      snapshotSeq: scenario.checkpoint.snapshotSeq,
      status: scenario.checkpoint.status,
      phase: scenario.checkpoint.phase,
      turn: scenario.checkpoint.turn,
      state: scenario.checkpoint.state,
      compatibility: scenario.checkpoint.compatibility,
    };
  }
  if (nodePins.length > 0) {
    metadata.nodePins = {
      enabled: true,
      mode: "mock",
      count: nodePins.length,
      items: nodePins.map((pin) => ({
        nodeId: pin.nodeId,
        nodeType: pin.nodeType,
        nodeHash: pin.nodeHash,
        runId: pin.runId,
        sessionId: pin.sessionId,
        eventSeq: pin.eventSeq,
        eventType: pin.eventType,
        input: pin.input,
        output: pin.output,
        updatedAt: pin.updatedAt,
      })),
    };
  }
  return metadata;
}

function buildStudioScenarioReplayFixture(
  flowId: string,
  flow: AgentFlow,
  scenario: StudioScenario,
  activePins: StudioNodePin[],
  stalePins: StudioNodePin[],
): StudioScenarioReplayFixture {
  const normalizedScenario = normalizeScenarioDefaults(scenario);
  const replayPins = normalizedScenario.useNodePins ? activePins : [];
  return {
    format: "agent-flow-builder.replay-fixture.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id || flowId,
      name: flow.name,
      version: flow.version,
      flowHash: hashStudioFlowDefinition(flow),
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
    },
    scenario: normalizedScenario,
    input: normalizedScenario.input,
    metadata: studioScenarioExecutionMetadata(normalizedScenario, replayPins),
    pins: {
      enabled: normalizedScenario.useNodePins,
      activeCount: activePins.length,
      staleCount: stalePins.length,
      active: activePins,
      stale: stalePins,
    },
  };
}

function buildStudioScenarioBatchReport(
  flowId: string,
  flow: AgentFlow,
  results: StudioScenarioBatchResult[],
  approval: StudioScenarioBatchApproval | null,
): StudioScenarioBatchReport {
  const summary = summarizeStudioScenarioBatchResults(results);
  const reportHash = studioScenarioBatchReportHash(flow, summary, results);
  return {
    format: "agent-flow-builder.scenario-batch-report.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id || flowId,
      name: flow.name,
      version: flow.version,
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
    },
    summary,
    results,
    approval: approval?.reportHash === reportHash ? approval : null,
    reportHash,
  };
}

function summarizeStudioScenarioBatchResults(results: StudioScenarioBatchResult[]): StudioScenarioBatchReportSummary {
  const okCount = results.filter((result) => result.status === "ok").length;
  const errorCount = results.filter((result) => result.status === "error").length;
  const passCount = results.filter((result) => result.comparison.severity === "pass").length;
  const warnCount = results.filter((result) => result.comparison.severity === "warn").length;
  const failCount = results.filter((result) => result.comparison.severity === "fail").length;
  const missingBaselineCount = results.filter((result) => result.comparison.severity === "missing").length;
  const comparisonErrorCount = results.filter((result) => result.comparison.severity === "error").length;
  const severity: StudioScenarioBatchReportSeverity =
    errorCount > 0 || comparisonErrorCount > 0
      ? "error"
      : failCount > 0
        ? "fail"
        : warnCount > 0 || missingBaselineCount > 0
          ? "warn"
          : "pass";
  return {
    resultCount: results.length,
    okCount,
    errorCount,
    passCount,
    warnCount,
    failCount,
    missingBaselineCount,
    comparisonErrorCount,
    severity,
  };
}

function studioScenarioBatchReportHash(
  flow: AgentFlow | null,
  summary: StudioScenarioBatchReportSummary,
  results: StudioScenarioBatchResult[],
): string {
  return simpleHash(stableStringify({
    flow: flow
      ? {
          id: flow.id,
          name: flow.name,
          version: flow.version,
          nodeCount: flow.nodes.length,
          edgeCount: flow.edges.length,
        }
      : null,
    summary,
    results,
  }));
}

function studioRunScenarioId(run: StudioRunRecord): string | null {
  const metadata = isRecord(run.session.metadata) ? run.session.metadata : {};
  const scenario = isRecord(metadata.scenario) ? metadata.scenario : {};
  return typeof scenario.id === "string" && scenario.id.trim() ? scenario.id : null;
}

function normalizeStudioScenarioReplayFixture(value: unknown): StudioScenarioReplayFixture | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.replay-fixture.v1") {
    return null;
  }
  const scenario = normalizeStudioScenario(value.scenario);
  if (!scenario) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const pins = isRecord(value.pins) ? value.pins : {};
  const activePins = normalizeStudioFixturePinList(pins.active);
  const stalePins = normalizeStudioFixturePinList(pins.stale);
  const input = typeof value.input === "string" ? value.input : scenario.input;
  const normalizedScenario = normalizeScenarioDefaults({ ...scenario, input });
  return {
    format: "agent-flow-builder.replay-fixture.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    flow: {
      id: typeof flow.id === "string" ? flow.id : "",
      name: typeof flow.name === "string" ? flow.name : "",
      version: typeof flow.version === "string" ? flow.version : "",
      flowHash: typeof flow.flowHash === "string" ? flow.flowHash : "",
      nodeCount: typeof flow.nodeCount === "number" && Number.isFinite(flow.nodeCount) ? flow.nodeCount : 0,
      edgeCount: typeof flow.edgeCount === "number" && Number.isFinite(flow.edgeCount) ? flow.edgeCount : 0,
    },
    scenario: normalizedScenario,
    input: normalizedScenario.input,
    metadata: isRecord(value.metadata) ? value.metadata : studioScenarioExecutionMetadata(normalizedScenario, activePins),
    pins: {
      enabled: pins.enabled === true || normalizedScenario.useNodePins,
      activeCount: activePins.length,
      staleCount: stalePins.length,
      active: activePins,
      stale: stalePins,
    },
  };
}

function normalizeStudioFixturePinList(value: unknown): StudioNodePin[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeStudioNodePin(item))
    .filter((item): item is StudioNodePin => item !== null);
}

function importedStudioFixturePins(fixture: StudioScenarioReplayFixture, now: string): StudioNodePin[] {
  const pinsByNode = new Map<string, StudioNodePin>();
  const timestamp = Date.now();
  [...fixture.pins.stale, ...fixture.pins.active].forEach((pin, index) => {
    pinsByNode.set(pin.nodeId, {
      ...pin,
      id: `node-pin-${pin.nodeId}-${timestamp}-${index}`,
      createdAt: now,
      updatedAt: now,
    });
  });
  return sortStudioNodePins(Array.from(pinsByNode.values()));
}

function loadStudioScenarios(flowId: string): StudioScenario[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(scenarioStorageKey(flowId));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeStudioScenario(item))
      .filter((item): item is StudioScenario => item !== null)
      .map(normalizeScenarioDefaults)
      .sort((left, right) => sortStudioScenarios(left, right));
  } catch {
    return [];
  }
}

function loadStudioNodePins(flowId: string): StudioNodePin[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(nodePinStorageKey(flowId));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortStudioNodePins(
      parsed
        .map((item) => normalizeStudioNodePin(item))
        .filter((item): item is StudioNodePin => item !== null),
    );
  } catch {
    return [];
  }
}

function normalizeStudioNodePin(value: unknown): StudioNodePin | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  if (typeof value.nodeId !== "string" || !value.nodeId.trim()) {
    return null;
  }
  const eventSeq = typeof value.eventSeq === "number" && Number.isFinite(value.eventSeq) ? value.eventSeq : 0;
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  return {
    id: value.id,
    nodeId: value.nodeId,
    nodeType: typeof value.nodeType === "string" && value.nodeType.trim() ? value.nodeType : "runtime",
    runId: typeof value.runId === "string" && value.runId.trim() ? value.runId : "run-atual",
    sessionId: typeof value.sessionId === "string" ? value.sessionId : "",
    eventSeq,
    eventType: typeof value.eventType === "string" && value.eventType.trim() ? value.eventType : "event",
    nodeHash: typeof value.nodeHash === "string" && value.nodeHash.trim() ? value.nodeHash : "unknown",
    input: "input" in value ? value.input : null,
    output: "output" in value ? value.output : null,
    createdAt,
    updatedAt,
  };
}

function normalizeStudioScenario(value: unknown): StudioScenario | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  return {
    id: value.id,
    label: typeof value.label === "string" ? value.label : "Cenário",
    input: typeof value.input === "string" ? value.input : "",
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [],
    isPinned: value.isPinned === true,
    useNodePins: value.useNodePins === true,
    regressionThresholds: normalizeStudioScenarioRegressionThresholds(value.regressionThresholds),
    createdAt,
    updatedAt,
    lastUsedAt: value.lastUsedAt === null || typeof value.lastUsedAt === "string" ? value.lastUsedAt : null,
    checkpoint: normalizeStudioScenarioCheckpoint(value.checkpoint),
  };
}

function normalizeStudioScenarioCheckpoint(value: unknown): StudioScenarioCheckpoint | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.eventSeq !== "number" || !Number.isFinite(value.eventSeq)) {
    return null;
  }
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  return {
    sourceRunId: typeof value.sourceRunId === "string" && value.sourceRunId.trim() ? value.sourceRunId : "run-atual",
    sourceSessionId: typeof value.sourceSessionId === "string" ? value.sourceSessionId : "",
    eventSeq: value.eventSeq,
    eventType: typeof value.eventType === "string" && value.eventType.trim() ? value.eventType : "event",
    nodeId: typeof value.nodeId === "string" && value.nodeId.trim() ? value.nodeId : null,
    snapshotSeq: typeof value.snapshotSeq === "number" && Number.isFinite(value.snapshotSeq) ? value.snapshotSeq : null,
    status: typeof value.status === "string" ? value.status : null,
    phase: typeof value.phase === "string" ? value.phase : null,
    turn: typeof value.turn === "number" && Number.isFinite(value.turn) ? value.turn : null,
    state: "state" in value ? value.state : null,
    input: "input" in value ? value.input : null,
    output: "output" in value ? value.output : null,
    createdAt,
    compatibility: normalizeStudioScenarioCheckpointCompatibility(value.compatibility),
  };
}

function normalizeStudioScenarioCheckpointCompatibility(value: unknown): StudioScenarioCheckpointCompatibility | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.flowId !== "string" ||
    !value.flowId.trim() ||
    typeof value.flowVersion !== "string" ||
    typeof value.flowHash !== "string" ||
    !value.flowHash.trim()
  ) {
    return null;
  }
  const projectHash = typeof value.projectHash === "string" && value.projectHash.trim()
    ? value.projectHash
    : typeof value.approvalFlowHash === "string" && value.approvalFlowHash.trim()
      ? value.approvalFlowHash
      : null;
  return {
    flowId: value.flowId,
    flowVersion: value.flowVersion,
    flowHash: value.flowHash,
    projectHash,
    nodeId: typeof value.nodeId === "string" && value.nodeId.trim() ? value.nodeId : null,
    nodeHash: typeof value.nodeHash === "string" && value.nodeHash.trim() ? value.nodeHash : null,
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : new Date().toISOString(),
  };
}

function normalizeScenarioDefaults(scenario: StudioScenario): StudioScenario {
  const tags = Array.from(new Set(splitTags(scenario.tags.join(", "))));
  const input = scenario.input.trim();
  return {
    ...scenario,
    label: scenario.label.trim() || "Cenário",
    input,
    tags,
    regressionThresholds: normalizeStudioScenarioRegressionThresholds(scenario.regressionThresholds),
  };
}

function normalizeStudioScenarioRegressionThresholds(value: unknown): StudioScenarioRegressionThresholds {
  const record = isRecord(value) ? value : {};
  return {
    tokenGrowthPct: normalizeRegressionThresholdValue(record.tokenGrowthPct, defaultStudioRegressionThresholds.tokenGrowthPct),
    costGrowthPct: normalizeRegressionThresholdValue(record.costGrowthPct, defaultStudioRegressionThresholds.costGrowthPct),
    durationGrowthPct: normalizeRegressionThresholdValue(record.durationGrowthPct, defaultStudioRegressionThresholds.durationGrowthPct),
  };
}

function normalizeRegressionThresholdInput(value: string, fallback: number): number {
  if (!value.trim()) {
    return fallback;
  }
  return normalizeRegressionThresholdValue(Number(value), fallback);
}

function normalizeRegressionThresholdValue(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1000, Math.round(numeric)));
}

function activeStudioNodePins(pins: StudioNodePin[], flow: AgentFlow | null): StudioNodePin[] {
  return sortStudioNodePins(
    pins.filter((pin) => hashStudioNodeDefinition(studioPinNodeForHash(flow, pin.nodeId)) === pin.nodeHash),
  );
}

function staleStudioNodePins(pins: StudioNodePin[], flow: AgentFlow | null): StudioNodePin[] {
  return sortStudioNodePins(
    pins.filter((pin) => hashStudioNodeDefinition(studioPinNodeForHash(flow, pin.nodeId)) !== pin.nodeHash),
  );
}

function hashStudioFlowDefinition(flow: AgentFlow | null): string {
  return simpleHash(stableStringify(flow ? normalizeFlowForCheckpointHash(flow) : { type: "flow" }));
}

function normalizeFlowForCheckpointHash(flow: AgentFlow): Record<string, unknown> {
  return {
    ...flow,
    nodes: flow.nodes.map(normalizeNodeForPinHash),
  };
}

function studioPinNodeForHash(flow: AgentFlow | null, nodeId: string): FlowNode | null {
  const existing = flow?.nodes.find((node) => node.id === nodeId);
  if (existing) {
    return existing;
  }
  if (nodeId === "start" || nodeId === "end") {
    return { id: nodeId, type: nodeId } as FlowNode;
  }
  return null;
}

function scenarioStorageKey(flowId: string): string {
  return `${scenarioStorageKeyPrefix}${flowId}`;
}

function nodePinStorageKey(flowId: string): string {
  return `${nodePinStorageKeyPrefix}${flowId}`;
}

function sortStudioNodePins(pins: StudioNodePin[]): StudioNodePin[] {
  return [...pins].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function hashStudioNodeDefinition(node: FlowNode | null): string {
  return simpleHash(stableStringify(node ? normalizeNodeForPinHash(node) : { type: "runtime" }));
}

function normalizeNodeForPinHash(node: FlowNode): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...node };
  delete rest.position;
  return rest;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function sortStudioScenarios(left: StudioScenario, right: StudioScenario): number {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }
  const leftLastUsed = left.lastUsedAt ? Date.parse(left.lastUsedAt) : Number.MIN_SAFE_INTEGER;
  const rightLastUsed = right.lastUsedAt ? Date.parse(right.lastUsedAt) : Number.MIN_SAFE_INTEGER;
  if (leftLastUsed !== rightLastUsed) {
    return rightLastUsed - leftLastUsed;
  }
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function sortScenarios(scenarios: StudioScenario[]): StudioScenario[] {
  return [...scenarios].sort((left, right) => sortStudioScenarios(left, right));
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function dockerRuntimeStatusLabel(
  status: DockerRuntimeStatus | null,
  busy: DockerRuntimeOperation | "refresh" | null,
): string {
  if (busy) {
    return "executando";
  }
  if (!status) {
    return "sem status";
  }
  if (status.lastStatus === "success") {
    return "ok";
  }
  if (status.lastStatus === "error") {
    return "erro";
  }
  if (status.lastStatus === "canceled") {
    return "cancelado";
  }
  return status.ready ? "pronto" : "pendente";
}

function dockerRuntimePillClass(status: DockerRuntimeStatus | null): string {
  if (status?.lastStatus === "success") {
    return "running";
  }
  if (status?.lastStatus === "error") {
    return "stopped";
  }
  if (status?.lastStatus === "canceled") {
    return "stopped";
  }
  return "";
}

function dockerProgressClass(status: string): string {
  if (status === "done" || status === "success") {
    return "progress-done";
  }
  if (status === "warning") {
    return "progress-warning";
  }
  if (status === "error" || status === "canceled") {
    return "progress-error";
  }
  return "progress-running";
}

function dockerProgressMatchesFilter(step: DockerRuntimeProgressEvent, filters: DockerHistoryFilterForm): boolean {
  const stageFilter = filters.progressStage.trim().toLowerCase();
  if (
    stageFilter &&
    ![step.stage, step.message, step.line].some((value) => value.toLowerCase().includes(stageFilter))
  ) {
    return false;
  }
  if (filters.progressStatus && step.status !== filters.progressStatus) {
    return false;
  }
  return true;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function manifestValidationMessage(result: RuntimeManifestValidationResult): string {
  return `${result.name}: ${result.agents.length} agente(s), modo ${result.packaging}.`;
}

function manifestGenerateMessage(result: RuntimeManifestGenerateResult): string {
  return `Bundle ${result.manifestId} gerado em ${result.outDir}.`;
}

function parseSandboxPort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Porta do sandbox deve ser um inteiro entre 1024 e 65535.");
  }
  return port;
}

function parseStudioRunDurationInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parsePortInput(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Porta ${label} deve ser um inteiro entre 1 e 65535.`);
  }
  return port;
}

function parsePositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

function toIsoDateTime(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error("from/to devem ser datas ISO válidas.");
  }
  return new Date(parsed).toISOString();
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactBaseName(outDir: string): string {
  return outDir.split(/[\\/]/).filter(Boolean).at(-1) || "runtime-artifact";
}

function llmAdapterOptions(adapters: LlmAdapterCatalogItem[], selectedAdapter: string): LlmAdapterCatalogItem[] {
  const selected = selectedAdapter.trim();
  if (!selected) {
    return adapters;
  }
  if (adapters.some((adapter) => adapter.id === selected)) {
    return adapters;
  }
  return [
    ...adapters,
    {
      id: selected,
      label: selected,
      status: "supported",
      protocol: "openai-responses",
      defaultModel: "",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
      notes: "Adapter carregado a partir do flow atual.",
    },
  ];
}

function isFlowWorkspaceExport(value: unknown): value is FlowWorkspaceExport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as FlowWorkspaceExport;
  return (
    candidate.format === "agent-flow-builder.flow-workspace.v1" &&
    Boolean(candidate.flow?.id) &&
    Array.isArray(candidate.prompts) &&
    Array.isArray(candidate.schemas)
  );
}

function downloadJsonFile(fileName: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  downloadBlobFile(fileName, blob);
}

function sanitizeFileNamePart(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "fixture";
}

function downloadBlobFile(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
