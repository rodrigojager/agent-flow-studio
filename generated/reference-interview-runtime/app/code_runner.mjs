import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

async function loadModule(request) {
  if (request.sourcePath) {
    const url = pathToFileURL(request.sourcePath);
    url.searchParams.set("t", String(Date.now()));
    return import(url.href);
  }

  if (!request.inlineSource) {
    throw new Error("missing_code_source");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-flow-js-"));
  const inlinePath = path.join(tempDir, "inline.mjs");
  await writeFile(inlinePath, request.inlineSource, "utf8");
  try {
    const url = pathToFileURL(inlinePath);
    url.searchParams.set("t", String(Date.now()));
    return await import(url.href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const raw = await readStdin();
  const request = raw ? JSON.parse(raw) : {};
  const module = await loadModule(request);
  const entryName = request.entry || "run";
  const entry = module[entryName] || module.default;
  if (typeof entry !== "function") {
    throw new Error("Entry point not found or not callable: " + entryName);
  }
  const output = await entry(request.input, request.context || {});
  process.stdout.write(JSON.stringify({ ok: true, output }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: serializeError(error) }));
  process.exitCode = 1;
});
