export interface FlowSummary {
  id: string;
  name: string | null;
  version: string | null;
  path: string;
  valid: boolean;
  error?: string;
}

export interface PromptRef {
  id: string;
  path: string;
  version: string;
  variables: string[];
}

export interface SchemaRef {
  id: string;
  path: string;
}

export interface FlowNode {
  id: string;
  type: string;
  description?: string;
  promptId?: string;
  outputSchema?: string;
  handler?: string;
  stage?: string;
  llm?: Record<string, unknown>;
  position?: {
    x: number;
    y: number;
  };
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface AgentFlow {
  id: string;
  name: string;
  version: string;
  runtime: string;
  api: {
    contract: string;
    resourceName: string;
    autoStartOnCreate: boolean;
  };
  persistence: {
    checkpointer: string;
    publicStore: string;
    cache: string;
  };
  llm: {
    adapter: string;
    model: string;
    apiKeyEnv?: string;
    baseUrlEnv?: string;
    mockEnv?: string;
  };
  state: {
    schemaRef: string;
  };
  prompts: PromptRef[];
  schemas: SchemaRef[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface LoadedFlow {
  path: string;
  flow: AgentFlow;
}

export interface ValidationResult {
  status: "ok";
  id: string;
  name: string;
  version: string;
  nodes: number;
  edges: number;
  contract: string;
}

export interface GenerateResult {
  status: "ok";
  flowId: string;
  flowPath: string;
  outDir: string;
}

export interface FlowAssetContent {
  id: string;
  path: string;
  content: string;
}

export interface SandboxStatus {
  flowId: string;
  running: boolean;
  port: number | null;
  pid: number | null;
  url: string | null;
  docsUrl: string | null;
  runtimeDir: string | null;
  logs: string[];
}

export interface SessionView {
  session_id: string;
  status: string;
  phase: string;
  turn: number;
  max_turns: number;
  metadata: Record<string, unknown>;
  is_complete: boolean;
}

export interface MessageView {
  seq: number;
  role: string;
  code?: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface EventView {
  seq: number;
  event_type: string;
  node?: string | null;
  payload: Record<string, unknown>;
}
