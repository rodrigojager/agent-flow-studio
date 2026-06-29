import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";
import { renderPythonRuntimeFiles } from "./pythonRuntimeTemplates.ts";

export interface GenerateOptions {
  flow: AgentFlow;
  flowRoot: string;
  outDir: string;
}

export async function generateLangGraphRuntime(options: GenerateOptions): Promise<void> {
  const { flow, flowRoot, outDir } = options;
  await rm(outDir, { force: true, recursive: true });
  await mkdir(path.join(outDir, "app", "prompts"), { recursive: true });
  await mkdir(path.join(outDir, "app", "schemas"), { recursive: true });
  await mkdir(path.join(outDir, ".agent-flow"), { recursive: true });

  await writeFile(
    path.join(outDir, ".agent-flow", "agent.flow.json"),
    `${JSON.stringify(flow, null, 2)}\n`,
    "utf-8",
  );

  for (const prompt of flow.prompts) {
    const content = await readFile(path.join(flowRoot, prompt.path), "utf-8");
    await writeFile(path.join(outDir, "app", "prompts", path.basename(prompt.path)), content, "utf-8");
  }

  for (const schema of flow.schemas) {
    const content = await readFile(path.join(flowRoot, schema.path), "utf-8");
    await writeFile(path.join(outDir, "app", "schemas", path.basename(schema.path)), content, "utf-8");
  }

  for (const file of renderPythonRuntimeFiles(flow)) {
    const target = path.join(outDir, file.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf-8");
  }
}
