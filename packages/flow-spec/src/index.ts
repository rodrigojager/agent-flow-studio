import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const NodeTypeSchema = z.enum([
  "start",
  "end",
  "llm_prompt",
  "llm_structured",
  "code",
  "switch",
  "human_input",
  "safety_gate",
  "http_request",
  "transform_json",
  "database_query",
  "database_save",
  "file_extract",
  "rag_retrieval",
  "approval_gate",
  "scoring",
  "analytics",
]);

export const PromptRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  variables: z.array(z.string().min(1)).default([]),
});

export const SchemaRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  version: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export const LlmConfigSchema = z.object({
  adapter: z.string().min(1),
  model: z.string().min(1),
  apiKeyEnv: z.string().min(1).optional(),
  baseUrlEnv: z.string().min(1).optional(),
  mockEnv: z.string().min(1).optional(),
});

export const SafetyRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  match: z.string().min(1),
  matchType: z.enum(["contains", "regex"]).default("contains").optional(),
  category: z.string().min(1).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium").optional(),
  action: z.enum(["warn", "safe_redirect", "block"]).default("safe_redirect").optional(),
  safeResponse: z.string().optional(),
});

export const SqlModeSchema = z.enum(["auto", "read", "mutation", "schema", "raw"]);

export const FlowTriggerSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    description: z.string().optional(),
    kind: z.enum(["interval", "cron", "event", "manual"]),
    enabled: z.boolean().default(true).optional(),
    intervalSeconds: z.number().int().positive().optional(),
    cronExpression: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    userMessage: z.string().optional(),
    input: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    maxTurns: z.number().int().positive().max(50).optional(),
    maxAttempts: z.number().int().positive().max(10).optional(),
    autoFinish: z.boolean().optional(),
  })
  .passthrough();

export type LlmAdapterStatus = "supported" | "planned";

export interface LlmLocalModelPreset {
  id: string;
  label: string;
  model: string;
  hardware: string;
  description: string;
}

export interface LlmAdapterCatalogItem {
  id: string;
  label: string;
  status: LlmAdapterStatus;
  protocol: "openai-responses";
  defaultModel: string;
  apiKeyEnv: string;
  baseUrlEnv?: string;
  mockEnv: string;
  defaultBaseUrl?: string;
  requiresApiKey?: boolean;
  defaultApiKey?: string;
  localModelPresets?: LlmLocalModelPreset[];
  notes: string;
}

export const LLM_ADAPTER_CATALOG: LlmAdapterCatalogItem[] = [
  {
    id: "codex-cli",
    label: "Codex CLI",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "default",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    mockEnv: "MOCK_LLM",
    notes: "Catálogo de modelos consultado pelo Codex CLI local; execução usa o runtime OpenAI-compatible configurado.",
  },
  {
    id: "openai",
    label: "OpenAI",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    mockEnv: "MOCK_LLM",
    notes: "Adaptador padrão para a API da OpenAI.",
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    mockEnv: "MOCK_LLM",
    notes: "Gateway compatível com o SDK OpenAI, configurado por base URL.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "openai/gpt-4.1-mini",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    mockEnv: "MOCK_LLM",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    notes: "Gateway OpenRouter usando protocolo compatível com OpenAI.",
  },
  {
    id: "ollama",
    label: "Ollama local",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "qwen3:8b",
    apiKeyEnv: "OLLAMA_API_KEY",
    baseUrlEnv: "OLLAMA_BASE_URL",
    mockEnv: "MOCK_LLM",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    defaultApiKey: "ollama",
    localModelPresets: [
      {
        id: "ollama-light-cpu",
        label: "Leve / CPU",
        model: "llama3.2:3b",
        hardware: "CPU ou notebook com pouca memória",
        description: "Preset conservador para testes locais rápidos, entrevistas simples e prompts curtos.",
      },
      {
        id: "ollama-balanced-local",
        label: "Equilibrado",
        model: "qwen3:8b",
        hardware: "Máquina local intermediária",
        description: "Preset padrão para agentes locais com melhor equilíbrio entre qualidade e custo de hardware.",
      },
      {
        id: "ollama-quality-local",
        label: "Qualidade local",
        model: "qwen3:14b",
        hardware: "Máquina com mais memória ou GPU local",
        description: "Preset para respostas mais fortes quando a máquina aguenta um modelo maior.",
      },
    ],
    notes: "Modelo local via Ollama/OpenAI-compatible em localhost; exige o modelo instalado localmente.",
  },
  {
    id: "opencode-go",
    label: "opencode Go",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "default",
    apiKeyEnv: "OPENCODE_GO_API_KEY",
    baseUrlEnv: "OPENCODE_GO_BASE_URL",
    mockEnv: "MOCK_LLM",
    defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    notes: "Gateway opencode Go compatível com OpenAI; configure OPENCODE_GO_BASE_URL para consultar e executar modelos.",
  },
  {
    id: "opencode-zen",
    label: "opencode Zen",
    status: "supported",
    protocol: "openai-responses",
    defaultModel: "default",
    apiKeyEnv: "OPENCODE_ZEN_API_KEY",
    baseUrlEnv: "OPENCODE_ZEN_BASE_URL",
    mockEnv: "MOCK_LLM",
    defaultBaseUrl: "https://opencode.ai/zen/v1",
    notes: "Gateway opencode Zen compatível com OpenAI; configure OPENCODE_ZEN_BASE_URL para consultar e executar modelos.",
  },
];

export function llmAdapterCatalog(): LlmAdapterCatalogItem[] {
  return LLM_ADAPTER_CATALOG.map((adapter) => ({
    ...adapter,
    localModelPresets: adapter.localModelPresets?.map((preset) => ({ ...preset })),
  }));
}

export function findLlmAdapter(adapterId: string): LlmAdapterCatalogItem | undefined {
  return LLM_ADAPTER_CATALOG.find((adapter) => adapter.id === adapterId.toLowerCase());
}

export function supportedLlmAdapterIds(): string[] {
  return LLM_ADAPTER_CATALOG.filter((adapter) => adapter.status === "supported").map((adapter) => adapter.id);
}

export function isSupportedLlmAdapter(adapterId: string): boolean {
  return findLlmAdapter(adapterId)?.status === "supported";
}

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const NodeSchema = z
  .object({
    id: z.string().min(1),
    type: NodeTypeSchema,
    description: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    promptId: z.string().min(1).optional(),
    outputSchema: z.string().min(1).optional(),
    handler: z.string().min(1).optional(),
    codeLanguage: z.enum(["python", "typescript", "javascript", "bash", "shell", "sh", "external"]).optional(),
    codeExecution: z.enum(["native", "inline", "file", "http", "mcp", "sidecar", "runtime_adapter"]).optional(),
    codePath: z.string().min(1).optional(),
    codeInline: z.string().min(1).optional(),
    codeEntry: z.string().min(1).optional(),
    codeDependencies: z.string().optional(),
    mcpCommand: z.string().min(1).optional(),
    mcpArgs: z.array(z.string().min(1)).optional(),
    mcpToolName: z.string().min(1).optional(),
    mcpProtocolVersion: z.string().min(1).optional(),
    sidecarCommand: z.string().min(1).optional(),
    sidecarArgs: z.array(z.string().min(1)).optional(),
    sandboxIsolation: z.enum(["shared", "ephemeral_workspace", "dedicated_process", "container", "vm"]).optional(),
    sandboxEnvAllowlist: z.array(z.string().min(1)).optional(),
    sandboxContainerImageId: z.string().min(1).optional(),
    sandboxContainerImage: z.string().min(1).optional(),
    sandboxContainerEngine: z.string().min(1).optional(),
    sandboxContainerProfile: z.enum(["baseline", "hardened"]).optional(),
    sandboxContainerMemory: z.string().min(1).optional(),
    sandboxContainerCpus: z.string().min(1).optional(),
    sandboxContainerPidsLimit: z.number().int().positive().optional(),
    sandboxContainerReadOnlyRootfs: z.boolean().optional(),
    sandboxContainerDropCapabilities: z.boolean().optional(),
    sandboxContainerNoNewPrivileges: z.boolean().optional(),
    sandboxVmImageId: z.string().min(1).optional(),
    sandboxVmRunner: z.string().min(1).optional(),
    sandboxVmArgs: z.array(z.string().min(1)).optional(),
    sandboxVmRunnerManifest: z.string().min(1).optional(),
    sandboxVmImage: z.string().min(1).optional(),
    sandboxVmImageManifest: z.string().min(1).optional(),
    sandboxVmEngine: z.enum(["qemu", "firecracker", "cloud-hypervisor", "custom"]).optional(),
    sandboxVmProfile: z.enum(["baseline", "hardened"]).optional(),
    sandboxVmMemory: z.string().min(1).optional(),
    sandboxVmCpus: z.string().min(1).optional(),
    stage: z.enum(["input", "output", "context"]).optional(),
    safetyMode: z.enum(["default", "custom", "default_and_custom"]).optional(),
    safetySeverityThreshold: z.enum(["low", "medium", "high", "critical"]).optional(),
    safetyFallbackResponse: z.string().optional(),
    safetyRules: z.array(SafetyRuleSchema).optional(),
    llm: LlmConfigSchema.partial().optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    url: z.string().min(1).optional(),
    bodyPath: z.string().min(1).optional(),
    responsePath: z.string().min(1).optional(),
    inputPath: z.string().min(1).optional(),
    outputPath: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    sqlMode: SqlModeSchema.optional(),
    table: z.string().min(1).optional(),
    dataPath: z.string().min(1).optional(),
    paramsPath: z.string().min(1).optional(),
    resultPath: z.string().min(1).optional(),
    sourcePath: z.string().min(1).optional(),
    contentPath: z.string().min(1).optional(),
    collectionPath: z.string().min(1).optional(),
    queryPath: z.string().min(1).optional(),
    contextPath: z.string().min(1).optional(),
    decisionPath: z.string().min(1).optional(),
    approvalValue: z.string().min(1).optional(),
    rejectionValue: z.string().min(1).optional(),
    payloadPath: z.string().min(1).optional(),
    metricName: z.string().min(1).optional(),
    threshold: z.number().min(0).max(1).optional(),
    topK: z.number().int().positive().max(20).optional(),
    chunkSize: z.number().int().positive().max(8000).optional(),
    maxChars: z.number().int().positive().max(1_000_000).optional(),
    maxRows: z.number().int().positive().max(500).optional(),
    timeoutSeconds: z.number().int().positive().max(120).optional(),
    retryAttempts: z.number().int().min(0).max(5).optional(),
    payloadAllowPaths: z.array(z.string().min(1)).optional(),
    redactPaths: z.array(z.string().min(1)).optional(),
    maxPayloadBytes: z.number().int().positive().max(10_000_000).optional(),
    position: NodePositionSchema.optional(),
  })
  .passthrough();

export const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().min(1).optional(),
});

export const AgentFlowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    runtime: z.literal("langgraph-python"),
    api: z.object({
      contract: z.literal("sessions-v1"),
      resourceName: z.string().min(1).default("sessions"),
      autoStartOnCreate: z.boolean().default(false),
    }),
    persistence: z.object({
      checkpointer: z.enum(["postgres", "memory"]),
      publicStore: z.enum(["postgres", "sqlite"]),
      cache: z.enum(["redis", "memory", "none"]),
    }),
    llm: LlmConfigSchema,
    state: z.object({
      schemaRef: z.string().min(1),
    }),
    prompts: z.array(PromptRefSchema).min(1),
    schemas: z.array(SchemaRefSchema).default([]),
    nodes: z.array(NodeSchema).default([]),
    edges: z.array(EdgeSchema).default([]),
    triggers: z.array(FlowTriggerSchema).optional(),
  })
  .superRefine((flow, ctx) => {
    const nodeIds = new Set(flow.nodes.map((node) => node.id));
    const promptIds = new Set(flow.prompts.map((prompt) => prompt.id));
    for (const node of flow.nodes) {
      if (node.promptId && !promptIds.has(node.promptId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", node.id, "promptId"],
          message: `Prompt '${node.promptId}' não existe em prompts.`,
        });
      }
    }
    for (const edge of flow.edges) {
      for (const endpoint of [edge.from, edge.to] as const) {
        if (!["start", "end"].includes(endpoint) && !nodeIds.has(endpoint)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges", `${edge.from}->${edge.to}`],
            message: `Edge referencia nó inexistente: ${endpoint}.`,
          });
        }
      }
    }
  });

export type AgentFlow = z.infer<typeof AgentFlowSchema>;

export type FlowDiagnosticSeverity = "error" | "warning" | "info";

export interface FlowDiagnostic {
  severity: FlowDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
  edgeIndex?: number;
  assetId?: string;
}

export interface FlowAnalysisSummary {
  nodes: number;
  edges: number;
  prompts: number;
  schemas: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface FlowAnalysisResult {
  status: "ok" | "error";
  diagnostics: FlowDiagnostic[];
  summary: FlowAnalysisSummary;
}

export const RuntimeManifestAgentSchema = z.object({
  id: z.string().min(1),
  flowPath: z.string().min(1),
  routePrefix: z.string().default(""),
});

export const RuntimeManifestHandoffSchema = z.object({
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  condition: z.string().optional(),
});

export const RuntimeManifestOrchestrationMemoryPolicySchema = z.object({
  enabled: z.boolean().default(true),
  persistence: z.enum(["disabled", "optional_jsonl", "always_jsonl"]).default("optional_jsonl"),
  defaultPersist: z.boolean().default(false),
  defaultMemoryPath: z.string().default(""),
  maxEntries: z.number().int().min(1).max(1000).default(64),
  retentionRuns: z.number().int().min(1).max(10000).default(50),
  maxPreviewChars: z.number().int().min(80).max(5000).default(500),
  redactKeys: z.array(z.string().min(1)).default(["api_key", "authorization", "password", "secret", "token"]),
  includeStepOutputs: z.boolean().default(true),
  includeHandoffDecisions: z.boolean().default(true),
});

export const RuntimeManifestOrchestrationSchema = z.object({
  mode: z.enum(["router", "sequential", "parallel"]).default("router"),
  entryAgentId: z.string().optional(),
  handoffs: z.array(RuntimeManifestHandoffSchema).default([]),
  memoryPolicy: RuntimeManifestOrchestrationMemoryPolicySchema.optional(),
});

export const RuntimeManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    packaging: z.enum(["monoagent", "multiagent"]),
    defaultLlm: LlmConfigSchema.optional(),
    agents: z.array(RuntimeManifestAgentSchema).min(1),
    orchestration: RuntimeManifestOrchestrationSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    const routePrefixes = new Set<string>();
    for (const agent of manifest.agents) {
      if (ids.has(agent.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", agent.id],
          message: `Agente duplicado no manifesto: ${agent.id}.`,
        });
      }
      ids.add(agent.id);

      if (paths.has(agent.flowPath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", agent.id, "flowPath"],
          message: `flowPath duplicado no manifesto: ${agent.flowPath}.`,
        });
      }
      paths.add(agent.flowPath);

      if (agent.routePrefix && !agent.routePrefix.startsWith("/")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", agent.id, "routePrefix"],
          message: "routePrefix deve ser vazio ou começar com '/'.",
        });
      }

      const normalizedRoutePrefix = agent.routePrefix.replace(/\/+$/g, "") || "/";
      if (agent.routePrefix && routePrefixes.has(normalizedRoutePrefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", agent.id, "routePrefix"],
          message: `routePrefix duplicado no manifesto: ${agent.routePrefix}.`,
        });
      }
      if (agent.routePrefix) {
        routePrefixes.add(normalizedRoutePrefix);
      }

      if (manifest.packaging === "multiagent" && (!agent.routePrefix || normalizedRoutePrefix === "/")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", agent.id, "routePrefix"],
          message: "Manifestos multiagent exigem routePrefix não vazio e diferente de '/'.",
        });
      }
    }

    if (manifest.orchestration?.entryAgentId && !ids.has(manifest.orchestration.entryAgentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orchestration", "entryAgentId"],
        message: `entryAgentId não aponta para um agente do manifesto: ${manifest.orchestration.entryAgentId}.`,
      });
    }

    for (const [handoffIndex, handoff] of (manifest.orchestration?.handoffs ?? []).entries()) {
      if (!ids.has(handoff.fromAgentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orchestration", "handoffs", handoffIndex, "fromAgentId"],
          message: `fromAgentId não aponta para um agente do manifesto: ${handoff.fromAgentId}.`,
        });
      }
      if (!ids.has(handoff.toAgentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orchestration", "handoffs", handoffIndex, "toAgentId"],
          message: `toAgentId não aponta para um agente do manifesto: ${handoff.toAgentId}.`,
        });
      }
      if (handoff.fromAgentId === handoff.toAgentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orchestration", "handoffs", handoffIndex, "toAgentId"],
          message: "handoff não pode apontar para o mesmo agente de origem.",
        });
      }
    }
  });

export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;

export function parseAgentFlow(value: unknown): AgentFlow {
  return AgentFlowSchema.parse(value);
}

export function analyzeAgentFlow(flow: AgentFlow): FlowAnalysisResult {
  const diagnostics: FlowDiagnostic[] = [];
  const add = (diagnostic: FlowDiagnostic) => diagnostics.push(diagnostic);
  const promptIds = new Set<string>();
  const schemaIds = new Set<string>();
  const schemaRefs = new Set<string>();
  const nodeCounts = new Map<string, number>();
  const endpointIds = new Set(["start", "end"]);

  validateLlmAdapter(flow.llm.adapter, "llm.adapter", add);

  for (const prompt of flow.prompts) {
    if (promptIds.has(prompt.id)) {
      add({
        severity: "error",
        code: "duplicate_prompt_id",
        message: `Prompt duplicado: ${prompt.id}.`,
        path: `prompts.${prompt.id}`,
        assetId: prompt.id,
      });
    }
    promptIds.add(prompt.id);
  }

  for (const schema of flow.schemas) {
    if (schemaIds.has(schema.id)) {
      add({
        severity: "error",
        code: "duplicate_schema_id",
        message: `Schema duplicado: ${schema.id}.`,
        path: `schemas.${schema.id}`,
        assetId: schema.id,
      });
    }
    schemaIds.add(schema.id);
    schemaRefs.add(schema.path);
  }

  if (!schemaIds.has(flow.state.schemaRef) && !schemaRefs.has(flow.state.schemaRef)) {
    add({
      severity: "error",
      code: "missing_state_schema",
      message: `Schema de estado não encontrado: ${flow.state.schemaRef}.`,
      path: "state.schemaRef",
      assetId: flow.state.schemaRef,
    });
  }

  const triggerIds = new Set<string>();
  for (const trigger of flow.triggers ?? []) {
    if (triggerIds.has(trigger.id)) {
      add({
        severity: "error",
        code: "duplicate_flow_trigger_id",
        message: `Trigger duplicado: ${trigger.id}.`,
        path: `triggers.${trigger.id}`,
        assetId: trigger.id,
      });
    }
    triggerIds.add(trigger.id);
    if (trigger.kind === "interval" && !trigger.intervalSeconds) {
      add({
        severity: "warning",
        code: "missing_interval_trigger_seconds",
        message: `Trigger ${trigger.id} é interval, mas não declara intervalSeconds.`,
        path: `triggers.${trigger.id}.intervalSeconds`,
        assetId: trigger.id,
      });
    }
    if (trigger.kind === "interval" && trigger.intervalSeconds && trigger.intervalSeconds < 60) {
      add({
        severity: "warning",
        code: "short_interval_trigger",
        message: `Trigger ${trigger.id} usa intervalo menor que 60 segundos; isso pode gerar carga excessiva.`,
        path: `triggers.${trigger.id}.intervalSeconds`,
        assetId: trigger.id,
      });
    }
    if (trigger.kind === "cron" && !trigger.cronExpression) {
      add({
        severity: "warning",
        code: "missing_cron_trigger_expression",
        message: `Trigger ${trigger.id} é cron, mas não declara cronExpression.`,
        path: `triggers.${trigger.id}.cronExpression`,
        assetId: trigger.id,
      });
    }
    if (trigger.kind === "event" && !trigger.eventType) {
      add({
        severity: "warning",
        code: "missing_event_trigger_type",
        message: `Trigger ${trigger.id} é event, mas não declara eventType.`,
        path: `triggers.${trigger.id}.eventType`,
        assetId: trigger.id,
      });
    }
  }

  for (const node of flow.nodes) {
    nodeCounts.set(node.id, (nodeCounts.get(node.id) ?? 0) + 1);
    if (node.id === "start" || node.id === "end") {
      add({
        severity: "error",
        code: "reserved_node_id",
        message: `ID de nó reservado: ${node.id}.`,
        path: `nodes.${node.id}.id`,
        nodeId: node.id,
      });
    }
    endpointIds.add(node.id);

    if ((node.type === "llm_prompt" || node.type === "llm_structured") && !node.promptId) {
      add({
        severity: "error",
        code: "missing_node_prompt",
        message: `Nó ${node.id} precisa referenciar um prompt.`,
        path: `nodes.${node.id}.promptId`,
        nodeId: node.id,
      });
    }
    if (node.promptId && !promptIds.has(node.promptId)) {
      add({
        severity: "error",
        code: "unknown_node_prompt",
        message: `Nó ${node.id} referencia prompt inexistente: ${node.promptId}.`,
        path: `nodes.${node.id}.promptId`,
        nodeId: node.id,
        assetId: node.promptId,
      });
    }
    if (node.type === "llm_structured" && !node.outputSchema) {
      add({
        severity: "error",
        code: "missing_structured_output_schema",
        message: `Nó estruturado ${node.id} precisa de outputSchema.`,
        path: `nodes.${node.id}.outputSchema`,
        nodeId: node.id,
      });
    }
    if (node.outputSchema && !schemaIds.has(node.outputSchema)) {
      add({
        severity: "error",
        code: "unknown_output_schema",
        message: `Nó ${node.id} referencia schema inexistente: ${node.outputSchema}.`,
        path: `nodes.${node.id}.outputSchema`,
        nodeId: node.id,
        assetId: node.outputSchema,
      });
    }
    if (node.llm?.adapter) {
      validateLlmAdapter(node.llm.adapter, `nodes.${node.id}.llm.adapter`, add, node.id);
    }
    if (node.llm?.apiKeyEnv || node.llm?.baseUrlEnv || node.llm?.mockEnv) {
      add({
        severity: "warning",
        code: "node_llm_env_override_not_emitted",
        message: `Nó ${node.id} declara env vars de LLM, mas o runtime gerado carrega credenciais no nível do flow.`,
        path: `nodes.${node.id}.llm`,
        nodeId: node.id,
      });
    }
    if (node.type === "safety_gate" && !node.stage) {
      add({
        severity: "warning",
        code: "missing_safety_stage",
        message: `Safety gate ${node.id} não declara stage.`,
        path: `nodes.${node.id}.stage`,
        nodeId: node.id,
      });
    }
    if (node.type === "safety_gate") {
      if (node.safetyMode === "custom" && !node.safetyRules?.length) {
        add({
          severity: "warning",
          code: "custom_safety_without_rules",
          message: `Safety gate ${node.id} usa modo custom, mas não declara safetyRules.`,
          path: `nodes.${node.id}.safetyRules`,
          nodeId: node.id,
        });
      }
      for (const [ruleIndex, rule] of (node.safetyRules ?? []).entries()) {
        if (rule.matchType === "regex") {
          try {
            new RegExp(rule.match);
          } catch {
            add({
              severity: "error",
              code: "invalid_safety_regex",
              message: `Regra de safety ${rule.id} do nó ${node.id} possui regex inválida.`,
              path: `nodes.${node.id}.safetyRules.${ruleIndex}.match`,
              nodeId: node.id,
            });
          }
        }
      }
    } else if (node.safetyRules?.length || node.safetyMode || node.safetySeverityThreshold || node.safetyFallbackResponse) {
      add({
        severity: "warning",
        code: "safety_policy_on_non_safety_node",
        message: `Nó ${node.id} declara política de safety, mas não é do tipo safety_gate.`,
        path: `nodes.${node.id}`,
        nodeId: node.id,
      });
    }
    if (node.type === "code") {
      const codeExecution = node.codeExecution ?? "native";
      const sandboxIsolation = node.sandboxIsolation ?? "shared";
      const externalContractExecutionModes = new Set(["http", "mcp", "sidecar", "runtime_adapter"]);
      if (!node.handler && !node.codePath && !node.codeInline && !externalContractExecutionModes.has(codeExecution)) {
        add({
          severity: "warning",
          code: "missing_code_contract",
          message: `Nó ${node.id} precisa declarar handler, codePath ou codeInline para representar comportamento customizado.`,
          path: `nodes.${node.id}`,
          nodeId: node.id,
        });
      }
      if ((codeExecution === "http" || (codeExecution === "runtime_adapter" && sandboxIsolation !== "vm")) && !node.url) {
        add({
          severity: "warning",
          code: codeExecution === "runtime_adapter" ? "missing_runtime_adapter_url" : "missing_code_http_url",
          message:
            codeExecution === "runtime_adapter"
              ? `Nó ${node.id} usa runtime_adapter e precisa declarar a URL do adapter.`
              : `Nó ${node.id} usa execução HTTP e precisa declarar url.`,
          path: `nodes.${node.id}.url`,
          nodeId: node.id,
        });
      }
      if (codeExecution === "mcp") {
        if (!node.mcpCommand) {
          add({
            severity: "warning",
            code: "missing_mcp_command",
            message: `Nó ${node.id} usa MCP e precisa declarar mcpCommand.`,
            path: `nodes.${node.id}.mcpCommand`,
            nodeId: node.id,
          });
        }
        if (!node.mcpToolName) {
          add({
            severity: "warning",
            code: "missing_mcp_tool_name",
            message: `Nó ${node.id} usa MCP e precisa declarar mcpToolName.`,
            path: `nodes.${node.id}.mcpToolName`,
            nodeId: node.id,
          });
        }
      }
      if (codeExecution === "sidecar" && !node.sidecarCommand) {
        add({
          severity: "warning",
          code: "missing_sidecar_command",
          message: `Nó ${node.id} usa sidecar e precisa declarar sidecarCommand.`,
          path: `nodes.${node.id}.sidecarCommand`,
          nodeId: node.id,
        });
      }
      const language = String(node.codeLanguage ?? "python").toLowerCase();
      const runtimeExecution = codeExecution === "native" || codeExecution === "inline" || codeExecution === "file";
      const runtimeAdapterVmExecution = codeExecution === "runtime_adapter" && sandboxIsolation === "vm";
      const nodeRuntimeExecution = ["javascript", "js", "typescript", "ts"].includes(language) && runtimeExecution;
      const shellRuntimeExecution = ["bash", "shell", "sh"].includes(language) && runtimeExecution;
      const processBackedExecution =
        codeExecution === "mcp" ||
        codeExecution === "sidecar" ||
        nodeRuntimeExecution ||
        shellRuntimeExecution;
      const pythonDedicatedProcessExecution =
        ["python", "py"].includes(language) &&
        runtimeExecution;
      const dedicatedProcessExecution = pythonDedicatedProcessExecution || shellRuntimeExecution;
      const containerExecution = dedicatedProcessExecution || nodeRuntimeExecution;
      const vmExecution = pythonDedicatedProcessExecution || nodeRuntimeExecution || shellRuntimeExecution || runtimeAdapterVmExecution;
      if (sandboxIsolation === "ephemeral_workspace" && !processBackedExecution) {
        add({
          severity: "warning",
          code: "code_sandbox_isolation_not_applicable",
          message: `sandboxIsolation=ephemeral_workspace do nó ${node.id} só se aplica a MCP, sidecar, Shell ou JavaScript/TypeScript por processo dedicado.`,
          path: `nodes.${node.id}.sandboxIsolation`,
          nodeId: node.id,
        });
      }
      if (sandboxIsolation === "dedicated_process" && !dedicatedProcessExecution) {
        add({
          severity: "warning",
          code: "code_sandbox_isolation_not_applicable",
          message: `sandboxIsolation=dedicated_process do nó ${node.id} só se aplica a Python ou Shell native/inline/file nesta camada inicial.`,
          path: `nodes.${node.id}.sandboxIsolation`,
          nodeId: node.id,
        });
      }
      if (sandboxIsolation === "container" && !containerExecution) {
        add({
          severity: "warning",
          code: "code_sandbox_isolation_not_applicable",
          message: `sandboxIsolation=container do nó ${node.id} só se aplica a Python, JavaScript, TypeScript ou Shell native/inline/file nesta camada inicial.`,
          path: `nodes.${node.id}.sandboxIsolation`,
          nodeId: node.id,
        });
      }
      if (sandboxIsolation === "container" && !node.sandboxContainerImage) {
        add({
          severity: "warning",
          code: "missing_code_container_image",
          message: `sandboxIsolation=container do nó ${node.id} precisa declarar sandboxContainerImage ou configurar AGENT_FLOW_CODE_CONTAINER_IMAGE no runtime.`,
          path: `nodes.${node.id}.sandboxContainerImage`,
          nodeId: node.id,
        });
      }
      if (sandboxIsolation === "vm" && !vmExecution) {
        add({
          severity: "warning",
          code: "code_sandbox_isolation_not_applicable",
          message: `sandboxIsolation=vm do nó ${node.id} só se aplica a Python, JavaScript, TypeScript ou Bash/Shell native/inline/file ou runtime_adapter nesta camada inicial.`,
          path: `nodes.${node.id}.sandboxIsolation`,
          nodeId: node.id,
        });
      }
      if (runtimeAdapterVmExecution && !node.codePath && !node.codeInline) {
        add({
          severity: "warning",
          code: "missing_runtime_adapter_vm_source",
          message: `Nó ${node.id} usa runtime_adapter em VM e precisa declarar codeInline ou codePath para o adapter executado no runner VM.`,
          path: `nodes.${node.id}.codeInline`,
          nodeId: node.id,
        });
      }
      if (sandboxIsolation === "vm" && !node.sandboxVmRunner) {
        add({
          severity: "warning",
          code: "missing_code_vm_runner",
          message: `sandboxIsolation=vm do nó ${node.id} precisa declarar sandboxVmRunner ou configurar AGENT_FLOW_CODE_VM_RUNNER no runtime.`,
          path: `nodes.${node.id}.sandboxVmRunner`,
          nodeId: node.id,
        });
      }
      if (node.sandboxContainerProfile && sandboxIsolation !== "container") {
        add({
          severity: "warning",
          code: "code_container_policy_not_applicable",
          message: `sandboxContainerProfile do nó ${node.id} só se aplica quando sandboxIsolation=container.`,
          path: `nodes.${node.id}.sandboxContainerProfile`,
          nodeId: node.id,
        });
      }
      if (node.sandboxVmProfile && sandboxIsolation !== "vm") {
        add({
          severity: "warning",
          code: "code_vm_policy_not_applicable",
          message: `sandboxVmProfile do nó ${node.id} só se aplica quando sandboxIsolation=vm.`,
          path: `nodes.${node.id}.sandboxVmProfile`,
          nodeId: node.id,
        });
      }
      if (node.sandboxVmImageId && sandboxIsolation !== "vm") {
        add({
          severity: "warning",
          code: "code_vm_image_not_applicable",
          message: `sandboxVmImageId do nó ${node.id} só se aplica quando sandboxIsolation=vm.`,
          path: `nodes.${node.id}.sandboxVmImageId`,
          nodeId: node.id,
        });
      }
      if ((node.sandboxVmRunnerManifest || node.sandboxVmImageManifest || node.sandboxVmEngine) && sandboxIsolation !== "vm") {
        add({
          severity: "warning",
          code: "code_vm_manifest_not_applicable",
          message: `Manifestos/engine VM do nó ${node.id} só se aplicam quando sandboxIsolation=vm.`,
          path: `nodes.${node.id}.sandboxVmRunnerManifest`,
          nodeId: node.id,
        });
      }
      if (node.sandboxContainerMemory && !/^[1-9]\d*(b|k|m|g|kb|mb|gb)$/i.test(node.sandboxContainerMemory)) {
        add({
          severity: "warning",
          code: "invalid_code_container_memory",
          message: `sandboxContainerMemory do nó ${node.id} deve usar formato Docker como 256m, 1g ou 512mb.`,
          path: `nodes.${node.id}.sandboxContainerMemory`,
          nodeId: node.id,
        });
      }
      if (node.sandboxContainerCpus && !/^[0-9]+(\.[0-9]+)?$/.test(node.sandboxContainerCpus)) {
        add({
          severity: "warning",
          code: "invalid_code_container_cpus",
          message: `sandboxContainerCpus do nó ${node.id} deve ser numérico, como 0.5 ou 1.`,
          path: `nodes.${node.id}.sandboxContainerCpus`,
          nodeId: node.id,
        });
      }
      if (node.sandboxVmMemory && !/^[1-9]\d*(b|k|m|g|kb|mb|gb)$/i.test(node.sandboxVmMemory)) {
        add({
          severity: "warning",
          code: "invalid_code_vm_memory",
          message: `sandboxVmMemory do nó ${node.id} deve usar formato como 512m, 1g ou 1024mb.`,
          path: `nodes.${node.id}.sandboxVmMemory`,
          nodeId: node.id,
        });
      }
      if (node.sandboxVmCpus && !/^[0-9]+(\.[0-9]+)?$/.test(node.sandboxVmCpus)) {
        add({
          severity: "warning",
          code: "invalid_code_vm_cpus",
          message: `sandboxVmCpus do nó ${node.id} deve ser numérico, como 1 ou 2.`,
          path: `nodes.${node.id}.sandboxVmCpus`,
          nodeId: node.id,
        });
      }
      if (node.codePath && !isSafeRelativePath(node.codePath)) {
        add({
          severity: "warning",
          code: "unsafe_code_path",
          message: `codePath do nó ${node.id} deve ser relativo e não pode usar caminho absoluto ou '..'.`,
          path: `nodes.${node.id}.codePath`,
          nodeId: node.id,
        });
      }
      if (node.inputPath && !isValidStatePath(node.inputPath)) {
        add({
          severity: "warning",
          code: "invalid_code_input_path",
          message: `inputPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.inputPath`,
          nodeId: node.id,
        });
      }
      for (const [field, values] of [
        ["payloadAllowPaths", node.payloadAllowPaths],
        ["redactPaths", node.redactPaths],
      ] as const) {
        for (const value of values ?? []) {
          const normalizedValue = value === "input" || value.startsWith("input.") ? "state" : value;
          if (!isValidStatePath(normalizedValue) && !value.startsWith("context.")) {
            add({
              severity: "warning",
              code: `invalid_code_${field}`,
              message: `${field} do nó ${node.id} contém caminho inválido: ${value}.`,
              path: `nodes.${node.id}.${field}`,
              nodeId: node.id,
            });
          }
        }
      }
      if (node.resultPath && !isValidStatePath(node.resultPath)) {
        add({
          severity: "warning",
          code: "invalid_code_result_path",
          message: `resultPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.resultPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "http_request") {
      if (!node.url) {
        add({
          severity: "warning",
          code: "missing_http_url",
          message: `Nó HTTP ${node.id} não declara url.`,
          path: `nodes.${node.id}.url`,
          nodeId: node.id,
        });
      }
      if (node.bodyPath && !isValidStatePath(node.bodyPath)) {
        add({
          severity: "warning",
          code: "invalid_http_body_path",
          message: `bodyPath do nó HTTP ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.bodyPath`,
          nodeId: node.id,
        });
      }
      if (node.responsePath && !isValidStatePath(node.responsePath)) {
        add({
          severity: "warning",
          code: "invalid_http_response_path",
          message: `responsePath do nó HTTP ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.responsePath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "transform_json") {
      if (node.inputPath && !isValidStatePath(node.inputPath)) {
        add({
          severity: "warning",
          code: "invalid_transform_input_path",
          message: `inputPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.inputPath`,
          nodeId: node.id,
        });
      }
      if (node.outputPath && !isValidStatePath(node.outputPath)) {
        add({
          severity: "warning",
          code: "invalid_transform_output_path",
          message: `outputPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.outputPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "database_query") {
      if (!node.query) {
        add({
          severity: "warning",
          code: "missing_database_query",
          message: `Nó de consulta ${node.id} não declara query SQL.`,
          path: `nodes.${node.id}.query`,
          nodeId: node.id,
        });
      }
      if (node.sqlMode === "read" && node.query && !isReadOnlySql(node.query)) {
        add({
          severity: "warning",
          code: "database_query_read_mode_with_non_read_sql",
          message: `Nó ${node.id} está em modo read, mas a query não parece ser somente leitura.`,
          path: `nodes.${node.id}.query`,
          nodeId: node.id,
        });
      }
      if (node.paramsPath && !isValidStatePath(node.paramsPath)) {
        add({
          severity: "warning",
          code: "invalid_database_params_path",
          message: `paramsPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.paramsPath`,
          nodeId: node.id,
        });
      }
      if (node.resultPath && !isValidStatePath(node.resultPath)) {
        add({
          severity: "warning",
          code: "invalid_database_result_path",
          message: `resultPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.resultPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "database_save") {
      if (node.table && !isValidSqlIdentifier(node.table)) {
        add({
          severity: "warning",
          code: "invalid_database_table",
          message: `Tabela do nó ${node.id} deve usar identificador SQL simples.`,
          path: `nodes.${node.id}.table`,
          nodeId: node.id,
        });
      }
      if (node.dataPath && !isValidStatePath(node.dataPath)) {
        add({
          severity: "warning",
          code: "invalid_database_data_path",
          message: `dataPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.dataPath`,
          nodeId: node.id,
        });
      }
      if (node.resultPath && !isValidStatePath(node.resultPath)) {
        add({
          severity: "warning",
          code: "invalid_database_save_result_path",
          message: `resultPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.resultPath`,
          nodeId: node.id,
        });
      }
      if (node.sqlMode === "read" && node.query && !isReadOnlySql(node.query)) {
        add({
          severity: "warning",
          code: "database_save_read_mode_with_non_read_sql",
          message: `Nó ${node.id} está em modo read, mas a query opcional não parece ser somente leitura.`,
          path: `nodes.${node.id}.query`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "file_extract") {
      if (!node.sourcePath) {
        add({
          severity: "warning",
          code: "missing_file_source_path",
          message: `Nó de arquivo ${node.id} não declara sourcePath.`,
          path: `nodes.${node.id}.sourcePath`,
          nodeId: node.id,
        });
      }
      if (node.sourcePath && !isSafeRelativePath(node.sourcePath)) {
        add({
          severity: "warning",
          code: "unsafe_file_source_path",
          message: `sourcePath do nó ${node.id} deve ficar dentro de files/ e não pode usar caminho absoluto ou '..'.`,
          path: `nodes.${node.id}.sourcePath`,
          nodeId: node.id,
        });
      }
      if (node.contentPath && !isValidStatePath(node.contentPath)) {
        add({
          severity: "warning",
          code: "invalid_file_content_path",
          message: `contentPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.contentPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "rag_retrieval") {
      if (!node.collectionPath) {
        add({
          severity: "warning",
          code: "missing_rag_collection_path",
          message: `Nó RAG ${node.id} não declara collectionPath.`,
          path: `nodes.${node.id}.collectionPath`,
          nodeId: node.id,
        });
      }
      if (node.collectionPath && !isSafeRelativePath(node.collectionPath)) {
        add({
          severity: "warning",
          code: "unsafe_rag_collection_path",
          message: `collectionPath do nó ${node.id} deve ficar dentro de files/ e não pode usar caminho absoluto ou '..'.`,
          path: `nodes.${node.id}.collectionPath`,
          nodeId: node.id,
        });
      }
      if (node.queryPath && !isValidStatePath(node.queryPath)) {
        add({
          severity: "warning",
          code: "invalid_rag_query_path",
          message: `queryPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.queryPath`,
          nodeId: node.id,
        });
      }
      if (node.contextPath && !isValidStatePath(node.contextPath)) {
        add({
          severity: "warning",
          code: "invalid_rag_context_path",
          message: `contextPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.contextPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "approval_gate") {
      if (node.decisionPath && !isValidStatePath(node.decisionPath)) {
        add({
          severity: "warning",
          code: "invalid_approval_decision_path",
          message: `decisionPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.decisionPath`,
          nodeId: node.id,
        });
      }
      if (node.resultPath && !isValidStatePath(node.resultPath)) {
        add({
          severity: "warning",
          code: "invalid_approval_result_path",
          message: `resultPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.resultPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "scoring") {
      if (node.inputPath && !isValidStatePath(node.inputPath)) {
        add({
          severity: "warning",
          code: "invalid_scoring_input_path",
          message: `inputPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.inputPath`,
          nodeId: node.id,
        });
      }
      if (node.resultPath && !isValidStatePath(node.resultPath)) {
        add({
          severity: "warning",
          code: "invalid_scoring_result_path",
          message: `resultPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.resultPath`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === "analytics") {
      if (node.payloadPath && !isValidStatePath(node.payloadPath)) {
        add({
          severity: "warning",
          code: "invalid_analytics_payload_path",
          message: `payloadPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.payloadPath`,
          nodeId: node.id,
        });
      }
      if (node.resultPath && !isValidStatePath(node.resultPath)) {
        add({
          severity: "warning",
          code: "invalid_analytics_result_path",
          message: `resultPath do nó ${node.id} deve ser um caminho simples de estado.`,
          path: `nodes.${node.id}.resultPath`,
          nodeId: node.id,
        });
      }
    }
  }

  for (const [nodeId, count] of nodeCounts.entries()) {
    if (count > 1) {
      add({
        severity: "error",
        code: "duplicate_node_id",
        message: `Nó duplicado: ${nodeId}.`,
        path: `nodes.${nodeId}`,
        nodeId,
      });
    }
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const seenEdges = new Set<string>();
  for (const [index, edge] of flow.edges.entries()) {
    if (!endpointIds.has(edge.from)) {
      add({
        severity: "error",
        code: "unknown_edge_source",
        message: `Aresta ${index} usa origem inexistente: ${edge.from}.`,
        path: `edges.${index}.from`,
        edgeIndex: index,
      });
    }
    if (!endpointIds.has(edge.to)) {
      add({
        severity: "error",
        code: "unknown_edge_target",
        message: `Aresta ${index} usa destino inexistente: ${edge.to}.`,
        path: `edges.${index}.to`,
        edgeIndex: index,
      });
    }
    if (edge.from === edge.to) {
      add({
        severity: "warning",
        code: "self_loop_edge",
        message: `Aresta ${index} cria loop no próprio nó ${edge.from}.`,
        path: `edges.${index}`,
        edgeIndex: index,
      });
    }
    const edgeKey = `${edge.from}->${edge.to}:${edge.condition ?? ""}`;
    if (seenEdges.has(edgeKey)) {
      add({
        severity: "warning",
        code: "duplicate_edge",
        message: `Aresta duplicada: ${edge.from} -> ${edge.to}.`,
        path: `edges.${index}`,
        edgeIndex: index,
      });
    }
    seenEdges.add(edgeKey);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }

  if (!(outgoing.get("start")?.length)) {
    add({
      severity: "error",
      code: "missing_start_edge",
      message: "O grafo precisa de pelo menos uma aresta saindo de start.",
      path: "edges",
    });
  }
  if (!(incoming.get("end")?.length)) {
    add({
      severity: "error",
      code: "missing_end_edge",
      message: "O grafo precisa de pelo menos uma aresta chegando em end.",
      path: "edges",
    });
  }

  const reachableFromStart = traverse("start", outgoing);
  const canReachEnd = reverseReachableFrom("end", incoming);
  for (const node of flow.nodes) {
    if (!incoming.has(node.id)) {
      add({
        severity: "error",
        code: "missing_node_input",
        message: `Nó ${node.id} não tem aresta de entrada.`,
        path: `nodes.${node.id}`,
        nodeId: node.id,
      });
    }
    if (!outgoing.has(node.id) && node.type !== "end") {
      add({
        severity: "error",
        code: "missing_node_output",
        message: `Nó ${node.id} não tem aresta de saída.`,
        path: `nodes.${node.id}`,
        nodeId: node.id,
      });
    }
    if (!reachableFromStart.has(node.id)) {
      add({
        severity: "error",
        code: "unreachable_node",
        message: `Nó ${node.id} não é alcançável a partir de start.`,
        path: `nodes.${node.id}`,
        nodeId: node.id,
      });
    }
    if (!canReachEnd.has(node.id)) {
      add({
        severity: "warning",
        code: "node_without_terminal_path",
        message: `Nó ${node.id} não possui caminho conhecido até end.`,
        path: `nodes.${node.id}`,
        nodeId: node.id,
      });
    }
  }

  const summary = summarizeAnalysis(flow, diagnostics);
  return {
    status: summary.errors > 0 ? "error" : "ok",
    diagnostics,
    summary,
  };
}

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  return RuntimeManifestSchema.parse(value);
}

export function agentFlowJsonSchema() {
  return zodToJsonSchema(AgentFlowSchema, "AgentFlow");
}

export function runtimeManifestJsonSchema() {
  return zodToJsonSchema(RuntimeManifestSchema, "RuntimeManifest");
}

function summarizeAnalysis(flow: AgentFlow, diagnostics: FlowDiagnostic[]): FlowAnalysisSummary {
  return {
    nodes: flow.nodes.length,
    edges: flow.edges.length,
    prompts: flow.prompts.length,
    schemas: flow.schemas.length,
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    infos: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
  };
}

function validateLlmAdapter(
  adapterId: string,
  path: string,
  add: (diagnostic: FlowDiagnostic) => void,
  nodeId?: string,
): void {
  const adapter = findLlmAdapter(adapterId);
  if (!adapter) {
    add({
      severity: "error",
      code: "unknown_llm_adapter",
      message: `Adaptador LLM desconhecido: ${adapterId}.`,
      path,
      nodeId,
    });
    return;
  }
  if (adapter.status !== "supported") {
    add({
      severity: "error",
      code: "planned_llm_adapter",
      message: `Adaptador LLM ainda não suportado pelo codegen: ${adapterId}.`,
      path,
      nodeId,
    });
  }
}

function isValidStatePath(value: string): boolean {
  return /^(state\.)?[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value);
}

function isValidSqlIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isReadOnlySql(value: string): boolean {
  const withoutComments = value
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim()
    .toLowerCase();
  return /^(select|with|show|pragma|explain|describe)\b/.test(withoutComments);
}

function isSafeRelativePath(value: string): boolean {
  return !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) && !value.split(/[\\/]+/).includes("..");
}

function traverse(start: string, outgoing: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of outgoing.get(current) ?? []) {
      stack.push(next);
    }
  }
  return seen;
}

function reverseReachableFrom(target: string, incoming: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const previous of incoming.get(current) ?? []) {
      stack.push(previous);
    }
  }
  return seen;
}
