import { readFile } from "node:fs/promises";
import { parseAgentFlow } from "./index.ts";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Uso: tsx packages/flow-spec/src/cli.ts <agent.flow.json>");
  process.exit(2);
}

const raw = await readFile(filePath, "utf-8");
const flow = parseAgentFlow(JSON.parse(raw));

console.log(
  JSON.stringify(
    {
      status: "ok",
      id: flow.id,
      nodes: flow.nodes.length,
      edges: flow.edges.length,
      contract: flow.api.contract,
    },
    null,
    2,
  ),
);
