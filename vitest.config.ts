import { defineConfig } from "vitest/config";

// Seuls les tests du framework sont exigés.
// Si une seule métrique passe sous 100 %, `npm test` échoue : c'est voulu.
export default defineConfig({
  test: {
    include: ["packages/framework/test/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});