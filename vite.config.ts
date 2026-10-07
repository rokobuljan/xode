import { defineConfig } from "vite-plus";
import type { Connect } from "vite-plus";

const frameProtectionHeaders = {
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
};

const frameProtection: Connect.NextHandleFunction = (request: Connect.IncomingMessage & { url?: string }, response, next) => {
    // Only the dedicated viewer may be framed; query flags never unlock the editor.
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname !== "/embed.html") {
        Object.entries(frameProtectionHeaders).forEach(([name, value]) => response.setHeader(name, value));
    }
    next();
};

export default defineConfig({
    base: "./",
    plugins: [
        {
            name: "xode-frame-protection",
            configureServer(server) {
                server.middlewares.use(frameProtection);
            },
            configurePreviewServer(server) {
                server.middlewares.use(frameProtection);
            },
        },
    ],
    build: {
        rolldownOptions: {
            input: { app: "index.html", embed: "embed.html" },
            output: {
                codeSplitting: {
                    // Cache Emmet separately while keeping Tab expansion immediately available.
                    groups: [{ name: "emmet", test: /node_modules[\\/]emmet[\\/]/ }],
                },
            },
        },
    },
    staged: {
        "*": "vp check --fix",
    },
    lint: { options: { typeAware: true, typeCheck: true } },
    fmt: {
        tabWidth: 4,
        singleQuote: false,
        printWidth: 240,
    },
    test: {
        // Vitest v4 compatibility: preserve mock call history.
        // Remove after tests no longer rely on calls from setup or earlier tests.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
        clearMocks: false,
        globals: true,
    },
});
