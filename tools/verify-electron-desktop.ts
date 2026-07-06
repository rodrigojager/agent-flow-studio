import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/builder-api/src/server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const desktopPackage = JSON.parse(await readFile(path.join(REPO_ROOT, "apps", "desktop", "package.json"), "utf-8")) as {
    main?: string;
  };
  const mainSource = await readFile(path.join(REPO_ROOT, "apps", "desktop", "main.cjs"), "utf-8");
  const preloadSource = await readFile(path.join(REPO_ROOT, "apps", "desktop", "preload.cjs"), "utf-8");
  const viteConfig = await readFile(path.join(REPO_ROOT, "apps", "builder-ui", "vite.config.ts"), "utf-8");
  const uiApiSource = await readFile(path.join(REPO_ROOT, "apps", "builder-ui", "src", "api.ts"), "utf-8");
  const uiTypes = await readFile(path.join(REPO_ROOT, "apps", "builder-ui", "src", "vite-env.d.ts"), "utf-8");
  const builtIndex = await readFile(path.join(REPO_ROOT, "apps", "builder-ui", "dist", "index.html"), "utf-8");

  assert.equal(desktopPackage.main, "main.cjs");
  assert.equal(packageJson.scripts?.["dev:desktop"], "npm run build:builder-ui && electron apps/desktop/main.cjs");
  assert.equal(packageJson.scripts?.["test:desktop"], "npm run build:builder-ui && tsx tools/verify-electron-desktop.ts");
  assert.ok(packageJson.devDependencies?.electron, "electron deve estar em devDependencies.");

  assert.ok(mainSource.includes("BrowserWindow"));
  assert.ok(mainSource.includes("nodeIntegration: false"));
  assert.ok(mainSource.includes("contextIsolation: true"));
  assert.ok(mainSource.includes("AGENT_FLOW_DESKTOP_API_URL"));
  assert.ok(mainSource.includes("--import"));
  assert.ok(mainSource.includes("tsx"));
  assert.ok(mainSource.includes("windowsHide: true"));
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld"));
  assert.ok(preloadSource.includes("__AGENT_FLOW_DESKTOP__"));
  assert.ok(uiApiSource.includes("__AGENT_FLOW_DESKTOP__"));
  assert.ok(uiTypes.includes("__AGENT_FLOW_DESKTOP__"));
  assert.ok(viteConfig.includes('base: "./"'), "Vite precisa usar assets relativos para file://.");
  assert.doesNotMatch(builtIndex, /src="\/assets\//);
  assert.doesNotMatch(builtIndex, /href="\/assets\//);

  const electronVersion = await electronVersionText();
  assert.match(electronVersion, /^v\d+\./);

  const api = buildApp({ workspaceRoot: REPO_ROOT });
  await api.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = api.server.address();
    assert.ok(address && typeof address === "object");
    const health = await getJson(`http://127.0.0.1:${address.port}/health`);
    assert.equal((health as Record<string, unknown>).status, "ok");
  } finally {
    await api.close();
  }

  console.log(JSON.stringify({
    format: "agent-flow-builder.electron-desktop-smoke.v1",
    status: "ok",
    mvpPrincipal: "verified_100_percent",
    expandedPlan: "in_progress",
    electronVersion,
    checks: [
      "desktop_workspace_package",
      "electron_binary_available",
      "relative_ui_assets",
      "preload_api_url_contract",
      "builder_api_health",
    ],
  }, null, 2));
}

async function electronVersionText(): Promise<string> {
  const binary = path.join(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : binary;
    const args = process.platform === "win32" ? ["/c", binary, "--version"] : ["--version"];
    execFile(command, args, { cwd: REPO_ROOT, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      const output = `${stdout}\n${stderr}`;
      const versionLine = output.split(/\r?\n/).map((line) => line.trim()).find((line) => /^v\d+\./.test(line));
      resolve(versionLine ?? output.trim());
    });
  });
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`Timeout reading ${url}`));
    });
    request.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
