const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const viteCli = path.join(repoRoot, "apps", "builder-ui", "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "5273"], {
  cwd: path.join(repoRoot, "apps", "builder-ui"),
  env: {
    ...process.env,
    VITE_BUILDER_API_URL: "http://127.0.0.1:3433",
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
