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
} from "@xyflow/react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CircleDot,
  Code2,
  Download,
  FileJson,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import {
  builderApiUrl,
  createFlowWorkspace,
  createRuntimeSession,
  createPromptAsset,
  createSchemaAsset,
  deletePromptAsset,
  deleteSchemaAsset,
  downloadGeneratedArtifactArchive,
  exportFlowWorkspace,
  finishRuntimeSession,
  generateFlow,
  generateRuntimeManifest,
  importFlowWorkspace,
  listGeneratedArtifact,
  listFlows,
  listLlmAdapters,
  listSandboxes,
  loadFlow,
  loadPromptAsset,
  loadRuntimeManifest,
  loadSchemaAsset,
  readGeneratedArtifactFile,
  runtimeEvents,
  runtimeTranscript,
  sandboxStatus,
  saveFlow,
  savePromptAsset,
  saveSchemaAsset,
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
  GenerateResult,
  GeneratedArtifactFileContent,
  GeneratedArtifactListing,
  LlmAdapterCatalogItem,
  LoadedFlow,
  LoadedRuntimeManifest,
  MessageView,
  RuntimeManifestGenerateResult,
  RuntimeManifestValidationResult,
  SandboxStatus,
  SessionView,
  ValidationResult,
} from "./types.ts";
import "./styles.css";

type InspectorTab = "properties" | "files" | "validation" | "json" | "artifact" | "runtime" | "sandbox";
type StatusKind = "idle" | "ok" | "error" | "busy";

interface StatusState {
  kind: StatusKind;
  message: string;
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
  { type: "end", label: "End", icon: CircleDot },
] as const;

const palette = nodeTypeOptions;

export default function App() {
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
  const [runtimeSession, setRuntimeSession] = useState<SessionView | null>(null);
  const [transcript, setTranscript] = useState<MessageView[]>([]);
  const [runtimeEventsData, setRuntimeEventsData] = useState<EventView[]>([]);
  const [userMessage, setUserMessage] = useState("Olá, quero testar este fluxo.");
  const [runtimeManifest, setRuntimeManifest] = useState<LoadedRuntimeManifest | null>(null);
  const [flowValidation, setFlowValidation] = useState<ValidationResult | null>(null);
  const [manifestValidation, setManifestValidation] = useState<RuntimeManifestValidationResult | null>(null);
  const [manifestGeneration, setManifestGeneration] = useState<RuntimeManifestGenerateResult | null>(null);
  const [artifactListing, setArtifactListing] = useState<GeneratedArtifactListing | null>(null);
  const [artifactContent, setArtifactContent] = useState<GeneratedArtifactFileContent | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState("");
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

  useEffect(() => {
    if (!selectedFlowId) {
      setLoadedFlow(null);
      setArtifactListing(null);
      setArtifactContent(null);
      setSelectedArtifactPath("");
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
        const [nextSandbox, listResult] = await Promise.all([sandboxStatus(loaded.flow.id), listSandboxes()]);
        if (!active) {
          return;
        }
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
        setRuntimeSession(null);
        setTranscript([]);
        setRuntimeEventsData([]);
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

  const graph = useMemo(
    () => toReactFlowGraph(draftFlow ?? undefined, selectedNodeId, selectedEdgeId),
    [draftFlow, selectedNodeId, selectedEdgeId],
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

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId("");
    setInspectorTab("properties");
  }, []);

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

  async function refreshGeneratedArtifact(outDir: string, preferredPath?: string): Promise<GeneratedArtifactListing> {
    const listing = await listGeneratedArtifact(outDir);
    setArtifactListing(listing);
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

  async function handleGenerate() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Gerando runtime de ${selectedFlowId}.` });
    try {
      if (isDirty && draftFlow) {
        const saved = await saveFlow(selectedFlowId, draftFlow);
        setLoadedFlow(saved);
        setDraftFlow(saved.flow);
        setIsDirty(false);
        setFlowValidation(null);
      }
      await saveDirtyAssets();
      const result = await generateFlow(selectedFlowId);
      const listing = await refreshGeneratedArtifact(result.outDir, "README.md");
      setInspectorTab("artifact");
      setStatus({ kind: "ok", message: `${generateMessage(result)} ${listing.files.length} arquivo(s) prontos.` });
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
      setStatus({ kind: "ok", message: "Sandbox parado." });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleRefreshSandbox() {
    await refreshSandboxState(selectedFlowId);
  }

  async function refreshRuntimeData(nextSession?: SessionView) {
    const session = nextSession ?? runtimeSession;
    if (!draftFlow || !sandbox?.url || !session) {
      return;
    }
    const [nextTranscript, nextEvents] = await Promise.all([
      runtimeTranscript(sandbox.url, draftFlow.api.resourceName, session.session_id),
      runtimeEvents(sandbox.url, draftFlow.api.resourceName, session.session_id),
    ]);
    setTranscript(nextTranscript);
    setRuntimeEventsData(nextEvents);
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

  return (
    <div className="app-shell">
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
          <button type="button" className="command-button" onClick={handleValidate} disabled={!selectedFlowId}>
            <CheckCircle2 size={17} aria-hidden="true" />
            Validar
          </button>
          <button type="button" className="command-button" onClick={handleSaveFlow} disabled={!selectedFlowId || !isDirty}>
            <FileJson size={17} aria-hidden="true" />
            {isDirty ? "Salvar" : "Salvo"}
          </button>
          <button type="button" className="command-button primary" onClick={handleGenerate} disabled={!selectedFlowId}>
            <Terminal size={17} aria-hidden="true" />
            Gerar
          </button>
          <button type="button" className="command-button" onClick={handleStartSandbox} disabled={!selectedFlowId}>
            <Send size={17} aria-hidden="true" />
            Sandbox
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
              {palette.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    className="palette-item"
                    key={item.type}
                    title={item.type}
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
            }}
            onConnect={handleConnect}
            onReconnect={handleReconnect}
            onNodesDelete={handleNodesDelete}
            onEdgesDelete={handleEdgesDelete}
            onNodeDragStop={handleNodeDragStop}
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
              Sandbox
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
              }}
              onSchemaChange={(value) => {
                setSchemaContent(value);
                setSchemaDirty(true);
                setFlowValidation(null);
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
              onSelectFile={handleSelectArtifactFile}
              onRefresh={handleRefreshArtifact}
              onDownload={handleDownloadArtifact}
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
              sandbox={sandbox}
              sandboxes={activeSandboxes}
              sandboxPort={sandboxPort}
              session={runtimeSession}
              transcript={transcript}
              events={runtimeEventsData}
              userMessage={userMessage}
              setSandboxPort={setSandboxPort}
              setUserMessage={setUserMessage}
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

      <footer className={`statusbar ${status.kind}`}>
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
            <label>
              <span>Handler</span>
              <input value={node.handler ?? ""} onChange={(event) => onNodeFieldChange(node.id, "handler", event.target.value)} />
            </label>
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
              {prompt.id} · {prompt.path}
            </option>
          ))}
        </select>
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
              {schema.id} · {schema.path}
            </option>
          ))}
        </select>
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
  onSelectFile,
  onRefresh,
  onDownload,
}: {
  listing: GeneratedArtifactListing | null;
  content: GeneratedArtifactFileContent | null;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
}) {
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
  sandbox,
  sandboxes,
  sandboxPort,
  session,
  transcript,
  events,
  userMessage,
  setSandboxPort,
  setUserMessage,
  onStartSandbox,
  onStopSandbox,
  onRefreshSandbox,
  onCreateSession,
  onSendTurn,
  onFinishSession,
}: {
  flow: AgentFlow | null;
  sandbox: SandboxStatus | null;
  sandboxes: SandboxStatus[];
  sandboxPort: string;
  session: SessionView | null;
  transcript: MessageView[];
  events: EventView[];
  userMessage: string;
  setSandboxPort: (value: string) => void;
  setUserMessage: (value: string) => void;
  onStartSandbox: () => void;
  onStopSandbox: () => void;
  onRefreshSandbox: () => void;
  onCreateSession: () => void;
  onSendTurn: () => void;
  onFinishSession: () => void;
}) {
  const running = Boolean(sandbox?.running && sandbox.url);
  return (
    <div className="sandbox-body">
      <section className="sandbox-section">
        <div className="sandbox-header">
          <strong>{flow?.id ?? "flow"}</strong>
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
          <strong>Events</strong>
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

function toReactFlowGraph(flow: AgentFlow | undefined, selectedNodeId: string, selectedEdgeId: string): { nodes: Node[]; edges: Edge[] } {
  if (!flow) {
    return { nodes: [], edges: [] };
  }
  const nodeIds = ["start", ...flow.nodes.map((node) => node.id), "end"];
  const nodes: Node[] = nodeIds.map((id, index) => {
    const flowNode = flow.nodes.find((node) => node.id === id);
    const isVirtual = isVirtualNodeId(id);
    return {
      id,
      position: flowNode?.position ?? defaultNodePosition(index),
      data: {
        label: isVirtual ? id.toUpperCase() : id,
        sublabel: flowNode?.type ?? "graph",
      },
      selected: selectedNodeId === id,
      className: `flow-node ${isVirtual ? "virtual" : flowNode?.type ?? ""}`,
      draggable: !isVirtual,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });

  const edges: Edge[] = flow.edges.map((edge, index) => ({
    id: edgeId(edge, index),
    source: edge.from,
    target: edge.to,
    label: edge.condition,
    selected: selectedEdgeId === edgeId(edge, index),
    markerEnd: { type: MarkerType.ArrowClosed },
    className: edge.condition ? "conditional-edge" : "plain-edge",
  }));
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

function generateMessage(result: GenerateResult): string {
  return `Runtime gerado em ${result.outDir}.`;
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
