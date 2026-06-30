import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAgentFlow } from "@agent-flow-builder/flow-spec";
import { generateLangGraphSandbox } from "./index.ts";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

const flowPath = readArg("--flow");
const outDir = readArg("--out");

if (!flowPath || !outDir) {
  console.error("Uso: tsx packages/codegen-langgraph/src/sandbox-cli.ts --flow <agent.flow.json> --out <dir>");
  process.exit(2);
}

const raw = await readFile(flowPath, "utf-8");
const flow = parseAgentFlow(JSON.parse(raw));
await generateLangGraphSandbox({
  flow,
  flowRoot: path.dirname(flowPath),
  outDir,
});

console.log(JSON.stringify({ status: "ok", generated: outDir, flow: flow.id, target: "langgraph-sandbox" }, null, 2));
