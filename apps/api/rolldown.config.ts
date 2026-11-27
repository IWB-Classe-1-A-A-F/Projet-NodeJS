import { defineConfig } from "rolldown";

// Tout est regroupé dans dist/main.js (framework et dépendances compris) :
// l'image de production ne contient ni sources TypeScript ni node_modules.
export default defineConfig({
  platform: "node",
  input: "src/main.ts",
  // pg charge `pg-native` seulement si on le demande ; on ne l'utilise pas.
  external: ["pg-native"],
  output: {
    file: "dist/main.js",
    format: "esm",
  },
});
