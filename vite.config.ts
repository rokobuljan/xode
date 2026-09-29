import { defineConfig } from "vite-plus";

const frameProtectionHeaders = {
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
};

export default defineConfig({
    base: "./",
    server: { headers: frameProtectionHeaders },
    preview: { headers: frameProtectionHeaders },
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
