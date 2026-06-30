import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.join(appRoot, "code");
const requireFromRunner = createRequire(import.meta.url);
const requireFromCode = createRequire(path.join(codeRoot, "package.json"));

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
    if (isTypeScriptRequest(request)) {
      const source = await readFile(request.sourcePath, "utf8");
      return loadTypeScriptModule(source, request.sourcePath);
    }
    const url = pathToFileURL(request.sourcePath);
    url.searchParams.set("t", String(Date.now()));
    return import(url.href);
  }

  if (!request.inlineSource) {
    throw new Error("missing_code_source");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-flow-js-"));
  const inlinePath = path.join(tempDir, isTypeScriptRequest(request) ? "inline.ts" : "inline.mjs");
  const modulePath = isTypeScriptRequest(request)
    ? await materializeTypeScriptModule(request.inlineSource, inlinePath, tempDir)
    : inlinePath;
  await writeFile(inlinePath, request.inlineSource, "utf8");
  try {
    const url = pathToFileURL(modulePath);
    url.searchParams.set("t", String(Date.now()));
    return await import(url.href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isTypeScriptRequest(request) {
  const language = String(request.language || "").toLowerCase();
  return language === "typescript" || language === "ts" || isTypeScriptPath(request.sourcePath || "");
}

function isTypeScriptPath(filePath) {
  return /\.tsx?$/i.test(String(filePath || ""));
}

async function loadTypeScriptModule(source, sourceName) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-flow-ts-"));
  try {
    const modulePath = await materializeTypeScriptModule(source, sourceName, tempDir);
    const url = pathToFileURL(modulePath);
    url.searchParams.set("t", String(Date.now()));
    return await import(url.href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function materializeTypeScriptModule(source, sourceName, tempDir) {
  const output = transpileTypeScript(source, sourceName);
  const modulePath = path.join(tempDir, path.basename(String(sourceName || "inline.ts")).replace(/\.tsx?$/i, ".mjs"));
  await writeFile(modulePath, output, "utf8");
  return modulePath;
}

function transpileTypeScript(source, sourceName) {
  try {
    const ts = requireFromCode("typescript");
    const result = ts.transpileModule(source, {
      fileName: String(sourceName || "agent-flow.ts"),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: false,
        inlineSources: false,
      },
    });
    return result.outputText;
  } catch {
    const nodeModule = requireFromRunner("node:module");
    if (typeof nodeModule.stripTypeScriptTypes === "function") {
      return nodeModule.stripTypeScriptTypes(source);
    }
    throw new Error("typescript_transpiler_unavailable");
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
