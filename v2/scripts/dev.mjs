// Accept the standard dev-server host/port flags and translate them for Wrangler.
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const option = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const port = option("--port", process.env.PORT || "4173");
if (!/^\d+$/.test(port)) throw new Error("Invalid port");
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    option("--host", "0.0.0.0"),
    "--port",
    port,
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
