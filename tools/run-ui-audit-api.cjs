const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsxCli, "apps/builder-api/src/server.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    AGENT_BUILDER_WORKSPACE: path.join(repoRoot, ".tmp", "ui-theme-workspace"),
    AGENT_BUILDER_DOCKER_RUNNER: "ui-audit-mock",
    HOST: "127.0.0.1",
    PORT: "3433",
  },
  stdio: "inherit",
});

forwardSignals(child);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function forwardSignals(processToStop) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      processToStop.kill(signal);
    });
  }
}
