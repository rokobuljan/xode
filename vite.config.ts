import { defineConfig } from "vite-plus";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, copyFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDist = "dist/xode.roxon.hr";
const sandboxDist = "dist/xode.box.roxon.hr";

export default defineConfig({
    base: "./",
    build: {
        outDir: appDist,
        emptyOutDir: true,
    },
    plugins: [
        {
            name: "dual-distribution-sandbox",
            closeBundle() {
                const outputDir = resolve(__dirname, sandboxDist);
                mkdirSync(outputDir, { recursive: true });
                copyFileSync(resolve(__dirname, "public", "sandbox.html"), resolve(outputDir, "index.html"));
                copyFileSync(resolve(__dirname, "public", "inject.js"), resolve(outputDir, "inject.js"));
                copyFileSync(resolve(__dirname, "public", "sandbox-bridge.js"), resolve(outputDir, "sandbox-bridge.js"));
            },
        },
    ],
    staged: {
        "*": "vp check --fix",
    },
    lint: { options: { typeAware: true, typeCheck: true } },
    fmt: {
        tabWidth: 4,
        singleQuote: false,
        printWidth: 240,
    },
});
