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
]);

export const PromptRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  version: z.string().min(1),
  variables: z.array(z.string().min(1)).default([]),
});

export const SchemaRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
});

export const LlmConfigSchema = z.object({
  adapter: z.string().min(1),
  model: z.string().min(1),
  apiKeyEnv: z.string().min(1).optional(),
  baseUrlEnv: z.string().min(1).optional(),
  mockEnv: z.string().min(1).optional(),
});

export type LlmAdapterStatus = "supported" | "planned";

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
  notes: string;
}

export const LLM_ADAPTER_CATALOG: LlmAdapterCatalogItem[] = [
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
    id: "opencode-go",
    label: "opencode Go",
    status: "planned",
    protocol: "openai-responses",
    defaultModel: "default",
    apiKeyEnv: "OPENCODE_GO_API_KEY",
    baseUrlEnv: "OPENCODE_GO_BASE_URL",
    mockEnv: "MOCK_LLM",
    notes: "Entrada planejada no catálogo; ainda não é emitida pelo codegen Python.",
  },
  {
    id: "opencode-zen",
    label: "opencode Zen",
    status: "planned",
    protocol: "openai-responses",
    defaultModel: "default",
    apiKeyEnv: "OPENCODE_ZEN_API_KEY",
    baseUrlEnv: "OPENCODE_ZEN_BASE_URL",
    mockEnv: "MOCK_LLM",
    notes: "Entrada planejada no catálogo; ainda não é emitida pelo codegen Python.",
  },
];

export function llmAdapterCatalog(): LlmAdapterCatalogItem[] {
  return LLM_ADAPTER_CATALOG.map((adapter) => ({ ...adapter }));
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
    promptId: z.string().min(1).optional(),
    outputSchema: z.string().min(1).optional(),
    handler: z.string().min(1).optional(),
    stage: z.enum(["input", "output", "context"]).optional(),
    llm: LlmConfigSchema.partial().optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    url: z.string().min(1).optional(),
    bodyPath: z.string().min(1).optional(),
    responsePath: z.string().min(1).optional(),
    inputPath: z.string().min(1).optional(),
    outputPath: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    table: z.string().min(1).optional(),
    dataPath: z.string().min(1).optional(),
    paramsPath: z.string().min(1).optional(),
    resultPath: z.string().min(1).optional(),
    maxRows: z.number().int().positive().max(500).optional(),
    timeoutSeconds: z.number().int().positive().max(120).optional(),
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
    nodes: z.array(NodeSchema).min(1),
    edges: z.array(EdgeSchema).min(1),
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

export const RuntimeManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    packaging: z.enum(["monoagent", "multiagent"]),
    defaultLlm: LlmConfigSchema.optional(),
    agents: z.array(RuntimeManifestAgentSchema).min(1),
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
    if (node.type === "code" && !node.handler) {
      add({
        severity: "warning",
        code: "missing_handler",
        message: `Nó ${node.id} não declara handler.`,
        path: `nodes.${node.id}.handler`,
        nodeId: node.id,
      });
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
