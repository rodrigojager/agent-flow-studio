import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAgentFlow, parseRuntimeManifest } from "@agent-flow-builder/flow-spec";
import { generateManifestRuntime, type ManifestAgentRuntime } from "./index.ts";

const args = process.argv.slice(2);
const manifestIndex = args.indexOf("--manifest");
const outIndex = args.indexOf("--out");

if (manifestIndex === -1 || !args[manifestIndex + 1]) {
  throw new Error("Uso: tsx packages/codegen-langgraph/src/manifest-cli.ts --manifest runtime.manifest.json --out generated/bundle");
}
if (outIndex === -1 || !args[outIndex + 1]) {
  throw new Error("Uso: tsx packages/codegen-langgraph/src/manifest-cli.ts --manifest runtime.manifest.json --out generated/bundle");
}

const workspaceRoot = process.cwd();
const manifestPath = path.resolve(workspaceRoot, args[manifestIndex + 1]);
const manifestRaw = await readFile(manifestPath, "utf-8");
const manifest = parseRuntimeManifest(JSON.parse(manifestRaw));
const agents: ManifestAgentRuntime[] = [];

for (const agent of manifest.agents) {
  const flowPath = path.resolve(workspaceRoot, agent.flowPath);
  const raw = await readFile(flowPath, "utf-8");
  const flow = parseAgentFlow(JSON.parse(raw));
  if (flow.id !== agent.id) {
    throw new Error(`Manifesto referencia agente ${agent.id}, mas o flow em ${agent.flowPath} tem id ${flow.id}.`);
  }
  agents.push({
    id: agent.id,
    routePrefix: agent.routePrefix,
    flow,
    flowRoot: path.dirname(flowPath),
  });
}

const outDir = path.resolve(workspaceRoot, args[outIndex + 1]);
await generateManifestRuntime({ manifest, agents, outDir });

console.log(
  JSON.stringify(
    {
      status: "ok",
      generated: path.relative(workspaceRoot, outDir).replaceAll(path.sep, "/"),
      manifest: manifest.id,
      agents: agents.map((agent) => agent.id),
    },
    null,
    2,
  ),
);
