import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/.turbo/**"],
  },
  js.configs.recommended,
  // Syntax-only TS linting everywhere (no tsconfig project required), so
  // config files and test files parse without needing a project-service entry.
  ...tseslint.configs.recommended,
  {
    // Type-aware linting only where a package's tsconfig actually includes
    // the files (its `src/`), so this never needs a default/out-of-project
    // fallback for test files or root-level *.config.ts files.
    files: ["**/src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Build scripts inside a package (the migration bundler, generators) run
    // under Node, so Node's globals are defined there. Declared rather than
    // pulled from the `globals` package: two names do not need a dependency.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  {
    rules: {
      // No `any` anywhere, which is a strict superset of "no `any` in
      // exported signatures" required by the project's TypeScript policy.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
