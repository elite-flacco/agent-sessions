import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ".worktrees/**"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
