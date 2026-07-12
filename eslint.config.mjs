import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "spikes/**", "docs/**"]
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.ts", "packages/**/*.ts", "scripts/**/*.mjs", "tests/architecture/**/*.mjs"],
    rules: {
      "no-console": "off"
    }
  }
);
