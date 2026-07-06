const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const uiIndexPath = path.join(repoRoot, "apps", "builder-ui", "dist", "index.html");
const defaultHost = "127.0.0.1";
const defaultPort = Number(process.env.AGENT_FLOW_DESKTOP_API_PORT || process.env.PORT || 3333);

let apiProcess = null;
let apiUrl = process.env.AGENT_FLOW_DESKTOP_API_URL || process.env.VITE_BUILDER_API_URL || "";

async function main() {
  app.setName("Agent Flow Studio");
  await app.whenReady();

  try {
    if (!fs.existsSync(uiIndexPath)) {
      throw new Error("UI build not found. Run `npm run build:builder-ui` before starting the desktop app.");
    }

    if (!apiUrl) {
      apiUrl = await startManagedApi();
    }
    process.env.AGENT_FLOW_DESKTOP_API_URL = apiUrl;

    createWindow();
  } catch (error) {
    dialog.showErrorBox("Agent Flow Studio", error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && apiUrl) {
      createWindow();
    }
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    title: "Agent Flow Studio",
    backgroundColor: "#f6f8fb",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.protocol !== "file:") {
      event.preventDefault();
      if (isExternalUrl(url)) {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.loadFile(uiIndexPath);
}

async function startManagedApi() {
  const existingUrl = `http://${defaultHost}:${defaultPort}`;
  if (await isHealthy(existingUrl)) {
    return existingUrl;
  }

  const port = await findAvailablePort(defaultPort);
  const managedUrl = `http://${defaultHost}:${port}`;
  const nodePath = process.env.npm_node_execpath || process.env.NODE || "node";
  const serverPath = path.join(repoRoot, "apps", "builder-api", "src", "server.ts");

  apiProcess = spawn(nodePath, ["--import", "tsx", serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: defaultHost,
      PORT: String(port),
      AGENT_BUILDER_WORKSPACE: process.env.AGENT_BUILDER_WORKSPACE || repoRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  apiProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[builder-api] ${chunk}`);
  });
  apiProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[builder-api] ${chunk}`);
  });

  await waitForHealth(managedUrl, 20000);
  return managedUrl;
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", () => {
        if (port >= startPort + 50) {
          reject(new Error(`No local port available from ${startPort} to ${startPort + 50}.`));
          return;
        }
        tryPort(port + 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, defaultHost);
    };
    tryPort(startPort);
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Builder API did not become healthy at ${url}/health.`);
}

function isHealthy(url) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/health`, { timeout: 1000 }, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          resolve(response.statusCode === 200 && payload.status === "ok");
        } catch {
          resolve(false);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

function isExternalUrl(url) {
  const target = new URL(url);
  return target.protocol === "http:" || target.protocol === "https:";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopManagedApi() {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
  }
  apiProcess = null;
}

app.on("before-quit", stopManagedApi);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

main();
