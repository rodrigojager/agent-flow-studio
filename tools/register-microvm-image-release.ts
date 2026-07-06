import path from "node:path";
import { registerMicrovmImageRelease } from "../apps/builder-api/src/vm-microvm-release-registration.ts";

const args = parseArgs(process.argv.slice(2));
if (!args.releaseIndex && !args["release-index"]) {
  throw new Error(
    [
      "Uso:",
      "  npm run vm-image:microvm-register -- --release-index dist/python-official-microvm.recipe/release/microvm-image-release.json --out dist/python-official-microvm.recipe/release/microvm-image-release.afvmrelease.json",
      "",
      "Opcional:",
      "  --workspace-root <dir>  default: cwd atual",
      "  --recipe-root <dir>     default: diretório pai de release/",
    ].join("\n"),
  );
}

const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());
const result = await registerMicrovmImageRelease({
  workspaceRoot,
  releaseIndexPath: path.resolve(workspaceRoot, args.releaseIndex || args["release-index"]),
  recipeRoot: args.recipeRoot ? path.resolve(workspaceRoot, args.recipeRoot) : undefined,
  outPath: args.out ? path.resolve(workspaceRoot, args.out) : undefined,
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(values: string[]): {
  workspaceRoot?: string;
  releaseIndex?: string;
  recipeRoot?: string;
  out?: string;
  [key: string]: string | undefined;
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
    releaseIndex: parsed["release-index"],
    recipeRoot: parsed["recipe-root"],
    out: parsed.out,
    ...parsed,
  };
}
