import path from "node:path";
import { createMicrovmOfficialImageRecipe } from "../apps/builder-api/src/vm-microvm-official-recipe.ts";

const args = parseArgs(process.argv.slice(2));
const outDir = args.out || path.resolve("dist", "agent-flow-python-microvm-official.recipe");
const result = await createMicrovmOfficialImageRecipe({
  outDir,
  imageId: args["image-id"],
  channel: args.channel,
  version: args.version,
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
