import path from "node:path";
import { packageVmImageBundle } from "../apps/builder-api/src/vm-image-bundle.ts";

const args = parseArgs(process.argv.slice(2));
if (!args.flowRoot || !args.runnerManifest || !args.imageManifest || !args.out) {
  throw new Error(
    [
      "Uso:",
      "  npm run vm-image:bundle -- --flow-root flows/reference-interview --runner-manifest .agent-flow/vm-runners/agent-flow-vm-runner.manifest.json --image-manifest images/agent-flow-python.afvmimage.json --out dist/python-qemu-microvm.afvmimagebundle",
      "",
      "Opcional:",
      "  --workspace-root <dir>  default: cwd atual",
    ].join("\n"),
  );
}

const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());
const result = await packageVmImageBundle({
  workspaceRoot,
  flowRoot: path.resolve(workspaceRoot, args.flowRoot),
  runnerManifestPath: args.runnerManifest,
  imageManifestPath: args.imageManifest,
  outDir: path.resolve(workspaceRoot, args.out),
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(values: string[]): {
  workspaceRoot?: string;
  flowRoot?: string;
  runnerManifest?: string;
  imageManifest?: string;
  out?: string;
} {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Argumento --${key} precisa de valor.`);
    }
    parsed[key] = next;
    index += 1;
  }
  return {
    workspaceRoot: parsed["workspace-root"],
    flowRoot: parsed["flow-root"],
    runnerManifest: parsed["runner-manifest"],
    imageManifest: parsed["image-manifest"],
    out: parsed.out,
  };
}
