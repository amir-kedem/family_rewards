import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
let revision = "";
try {
  revision = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  // Source archives have no Git checkout. Show the package version alone.
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_REVISION__: JSON.stringify(revision),
  },
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "dist" },
});
