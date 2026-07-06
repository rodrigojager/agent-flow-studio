import path from "node:path";
import { createMicrovmImageScaffold, createVmImageScaffold } from "../apps/builder-api/src/vm-image-scaffold.ts";

const args = parseArgs(process.argv.slice(2));
const engine = normalizeEngine(args.engine);
const outDir = args.out || args["out-dir"] || path.resolve("dist", engine === "qemu" ? "agent-flow-python-qemu.vmimage" : "agent-flow-python-microvm.vmimage");
const imageId = args["image-id"] || (engine === "qemu" ? "agent-flow-python-qemu" : "agent-flow-python-microvm");

const result = engine === "qemu"
  ? await createVmImageScaffold({ outDir, imageId })
  : await createMicrovmImageScaffold({ outDir, imageId });
console.log(JSON.stringify(result, null, 2));

function normalizeEngine(value: string | undefined): "qemu" | "microvm" {
  const normalized = (value || "qemu").trim().toLowerCase();
  if (normalized === "qemu") {
    return "qemu";
  }
  if (normalized === "microvm" || normalized === "firecracker" || normalized === "cloud-hypervisor") {
    return "microvm";
  }
  throw new Error("Unsupported --engine. Use qemu, microvm, firecracker or cloud-hypervisor.");
}

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
