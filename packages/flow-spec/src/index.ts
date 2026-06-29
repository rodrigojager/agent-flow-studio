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

export function parseAgentFlow(value: unknown): AgentFlow {
  return AgentFlowSchema.parse(value);
}

export function agentFlowJsonSchema() {
  return zodToJsonSchema(AgentFlowSchema, "AgentFlow");
}
