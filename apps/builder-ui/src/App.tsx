import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CircleDot,
  Code2,
  FileJson,
  GitBranch,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import {
  builderApiUrl,
  createRuntimeSession,
  finishRuntimeSession,
  generateFlow,
  listFlows,
  loadFlow,
  loadPromptAsset,
  loadSchemaAsset,
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
} from "./api.ts";
import type {
  AgentFlow,
  EventView,
  FlowNode,
  FlowSummary,
  GenerateResult,
  LoadedFlow,
  MessageView,
  SandboxStatus,
  SessionView,
  ValidationResult,
} from "./types.ts";
import "./styles.css";

type InspectorTab = "properties" | "files" | "json" | "sandbox";
type StatusKind = "idle" | "ok" | "error" | "busy";

interface StatusState {
  kind: StatusKind;
  message: string;
}

const palette = [
  { type: "start", label: "Start", icon: Play },
  { type: "safety_gate", label: "Safety", icon: ShieldCheck },
  { type: "llm_prompt", label: "LLM", icon: Sparkles },
  { type: "code", label: "Code", icon: Code2 },
  { type: "switch", label: "Switch", icon: GitBranch },
  { type: "end", label: "End", icon: CircleDot },
];

export default function App() {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>("");
  const [loadedFlow, setLoadedFlow] = useState<LoadedFlow | null>(null);
  const [draftFlow, setDraftFlow] = useState<AgentFlow | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [runtimeSession, setRuntimeSession] = useState<SessionView | null>(null);
  const [transcript, setTranscript] = useState<MessageView[]>([]);
  const [runtimeEventsData, setRuntimeEventsData] = useState<EventView[]>([]);
  const [userMessage, setUserMessage] = useState("Olá, quero testar este fluxo.");
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [promptContent, setPromptContent] = useState("");
  const [schemaContent, setSchemaContent] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [schemaDirty, setSchemaDirty] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    kind: "idle",
    message: "Builder API aguardando ação.",
  });

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
    if (!selectedFlowId) {
      setLoadedFlow(null);
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
        setLoadedFlow(loaded);
        setDraftFlow(loaded.flow);
        setIsDirty(false);
        setSelectedNodeId("start");
        setSelectedPromptId(loaded.flow.prompts[0]?.id ?? "");
        setSelectedSchemaId(loaded.flow.schemas[0]?.id ?? "");
        setPromptContent("");
        setSchemaContent("");
        setPromptDirty(false);
        setSchemaDirty(false);
        setRuntimeSession(null);
        setTranscript([]);
        setRuntimeEventsData([]);
        setStatus({ kind: "ok", message: `${loaded.flow.name} carregado.` });
        const nextSandbox = await sandboxStatus(loaded.flow.id);
        if (active) {
          setSandbox(nextSandbox);
        }
      } catch (error) {
        if (!active) {
          return;
        }
        setLoadedFlow(null);
        setDraftFlow(null);
        setIsDirty(false);
        setStatus({ kind: "error", message: errorMessage(error) });
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [selectedFlowId]);

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

  const graph = useMemo(() => toReactFlowGraph(draftFlow ?? undefined, selectedNodeId), [draftFlow, selectedNodeId]);

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

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
    setInspectorTab("properties");
  }, []);

  function updateDraft(mutator: (flow: AgentFlow) => AgentFlow) {
    setDraftFlow((current) => {
      if (!current) {
        return current;
      }
      const next = mutator(current);
      setIsDirty(true);
      return next;
    });
  }

  function updateFlowField<K extends keyof Pick<AgentFlow, "name" | "version">>(key: K, value: AgentFlow[K]) {
    updateDraft((flow) => ({ ...flow, [key]: value }));
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
    }
    if (schemaDirty && selectedSchemaId) {
      const savedSchema = await saveSchemaAsset(selectedFlowId, selectedSchemaId, schemaContent);
      setSchemaContent(savedSchema.content);
      setSchemaDirty(false);
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
      setStatus({ kind: "ok", message: `Schema salvo em ${saved.path}.` });
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
      const result = await validateFlow(selectedFlowId);
      setStatus({ kind: "ok", message: validationMessage(result) });
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
      }
      await saveDirtyAssets();
      const result = await generateFlow(selectedFlowId);
      setStatus({ kind: "ok", message: generateMessage(result) });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  async function handleStartSandbox() {
    if (!selectedFlowId) {
      return;
    }
    setStatus({ kind: "busy", message: `Gerando e iniciando sandbox de ${selectedFlowId}.` });
    try {
      if (isDirty && draftFlow) {
        const saved = await saveFlow(selectedFlowId, draftFlow);
        setLoadedFlow(saved);
        setDraftFlow(saved.flow);
        setIsDirty(false);
      }
      await saveDirtyAssets();
      await generateFlow(selectedFlowId);
      const result = await startSandbox(selectedFlowId);
      setSandbox(result);
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
      setRuntimeSession(null);
      setTranscript([]);
      setRuntimeEventsData([]);
      setStatus({ kind: "ok", message: "Sandbox parado." });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
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
                  <button type="button" className="palette-item" key={item.type} title={item.type}>
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
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
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
              Propriedades
            </button>
            <button
              type="button"
              className={inspectorTab === "files" ? "active" : ""}
              onClick={() => setInspectorTab("files")}
            >
              Arquivos
            </button>
            <button type="button" className={inspectorTab === "json" ? "active" : ""} onClick={() => setInspectorTab("json")}>
              JSON
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
            <NodeInspector
              flow={draftFlow}
              node={selectedNode}
              onFlowFieldChange={updateFlowField}
              onNodeFieldChange={updateNodeField}
            />
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
              }}
              onSchemaChange={(value) => {
                setSchemaContent(value);
                setSchemaDirty(true);
              }}
              onPromptSave={handleSavePrompt}
              onSchemaSave={handleSaveSchema}
            />
          ) : inspectorTab === "json" ? (
            <pre className="json-preview">{draftFlow ? JSON.stringify(draftFlow, null, 2) : "{}"}</pre>
          ) : (
            <SandboxPanel
              flow={draftFlow}
              sandbox={sandbox}
              session={runtimeSession}
              transcript={transcript}
              events={runtimeEventsData}
              userMessage={userMessage}
              setUserMessage={setUserMessage}
              onStartSandbox={handleStartSandbox}
              onStopSandbox={handleStopSandbox}
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
  onFlowFieldChange,
  onNodeFieldChange,
}: {
  flow: AgentFlow | null;
  node: FlowNode | null;
  onFlowFieldChange: <K extends keyof Pick<AgentFlow, "name" | "version">>(key: K, value: AgentFlow[K]) => void;
  onNodeFieldChange: (nodeId: string, key: keyof FlowNode, value: string) => void;
}) {
  if (!flow || !node) {
    return (
      <div className="empty-state">
        <AlertCircle size={18} aria-hidden="true" />
        <span>Nenhum nó selecionado.</span>
      </div>
    );
  }
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
          <label>
            <span>Handler</span>
            <input value={node.handler ?? ""} onChange={(event) => onNodeFieldChange(node.id, "handler", event.target.value)} />
          </label>
          <label>
            <span>Stage</span>
            <select value={node.stage ?? ""} onChange={(event) => onNodeFieldChange(node.id, "stage", event.target.value)}>
              <option value="">-</option>
              <option value="input">input</option>
              <option value="output">output</option>
              <option value="context">context</option>
            </select>
          </label>
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
  onPromptSave,
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
  onPromptSave: () => void;
  onSchemaSave: () => void;
}) {
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

function SandboxPanel({
  flow,
  sandbox,
  session,
  transcript,
  events,
  userMessage,
  setUserMessage,
  onStartSandbox,
  onStopSandbox,
  onCreateSession,
  onSendTurn,
  onFinishSession,
}: {
  flow: AgentFlow | null;
  sandbox: SandboxStatus | null;
  session: SessionView | null;
  transcript: MessageView[];
  events: EventView[];
  userMessage: string;
  setUserMessage: (value: string) => void;
  onStartSandbox: () => void;
  onStopSandbox: () => void;
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
          <Field label="PID" value={sandbox?.pid ? String(sandbox.pid) : "-"} />
        </dl>
        <div className="sandbox-actions">
          <button type="button" className="command-button primary" onClick={onStartSandbox}>
            <Play size={16} aria-hidden="true" />
            Iniciar
          </button>
          <button type="button" className="command-button" onClick={onStopSandbox} disabled={!running}>
            <CircleDot size={16} aria-hidden="true" />
            Parar
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
            <span>{sandbox.logs.length}</span>
          </div>
          <pre className="mini-json">{sandbox.logs.slice(-16).join("\n")}</pre>
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

function toReactFlowGraph(flow: AgentFlow | undefined, selectedNodeId: string): { nodes: Node[]; edges: Edge[] } {
  if (!flow) {
    return { nodes: [], edges: [] };
  }
  const nodeIds = ["start", ...flow.nodes.map((node) => node.id), "end"];
  const nodes: Node[] = nodeIds.map((id, index) => {
    const flowNode = flow.nodes.find((node) => node.id === id);
    const isVirtual = id === "start" || id === "end";
    return {
      id,
      position: {
        x: index * 230,
        y: index % 2 === 0 ? 140 : 300,
      },
      data: {
        label: isVirtual ? id.toUpperCase() : id,
        sublabel: flowNode?.type ?? "graph",
      },
      selected: selectedNodeId === id,
      className: `flow-node ${isVirtual ? "virtual" : flowNode?.type ?? ""}`,
    };
  });

  const edges: Edge[] = flow.edges.map((edge, index) => ({
    id: `${edge.from}-${edge.to}-${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.condition,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: edge.condition ? "conditional-edge" : "plain-edge",
  }));
  return { nodes, edges };
}

function validationMessage(result: ValidationResult): string {
  return `${result.name}: ${result.nodes} nós, ${result.edges} arestas, contrato ${result.contract}.`;
}

function generateMessage(result: GenerateResult): string {
  return `Runtime gerado em ${result.outDir}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
