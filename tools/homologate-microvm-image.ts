import path from "node:path";
import { createMicrovmHomologation } from "../apps/builder-api/src/vm-image-homologation.ts";

const args = parseArgs(process.argv.slice(2));
if (!args.flowRoot || !args.runnerManifest || !args.imageManifest || !args.out) {
  throw new Error(
    [
      "Uso:",
      "  npm run vm-image:homologate -- --flow-root dist/python-microvm.vmimage --runner-manifest manifests/runner.manifest.json --image-manifest manifests/image.manifest.json --out dist/python-microvm.vmimage/manifests/microvm.homologation.json",
      "",
      "Opcional:",
      "  --workspace-root <dir>        default: cwd atual",
      "  --policy-manifest <path>      default: policyManifest do manifesto da imagem",
      "  --preflight-evidence <path>   JSON gerado pelo runner microVM --preflight",
      "  --boot-evidence <path>        JSON gerado por test:vm-microvm-real-smoke em mode real-boot",
    ].join("\n"),
  );
}

const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());
const result = await createMicrovmHomologation({
  workspaceRoot,
  flowRoot: path.resolve(workspaceRoot, args.flowRoot),
  runnerManifestPath: args.runnerManifest,
  imageManifestPath: args.imageManifest,
  outPath: path.resolve(workspaceRoot, args.out),
  policyManifestPath: args.policyManifest,
  preflightEvidencePath: args.preflightEvidence,
  bootEvidencePath: args.bootEvidence,
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(values: string[]): {
  workspaceRoot?: string;
  flowRoot?: string;
  runnerManifest?: string;
  imageManifest?: string;
  policyManifest?: string;
  preflightEvidence?: string;
  bootEvidence?: string;
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
    policyManifest: parsed["policy-manifest"],
    preflightEvidence: parsed["preflight-evidence"],
    bootEvidence: parsed["boot-evidence"],
    out: parsed.out,
  };
}
