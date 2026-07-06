const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("__AGENT_FLOW_DESKTOP__", {
  apiUrl: process.env.AGENT_FLOW_DESKTOP_API_URL || "http://127.0.0.1:3333",
  runtime: "electron",
});
