import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
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
