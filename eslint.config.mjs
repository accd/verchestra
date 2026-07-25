import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "spikes/**",
      "docs/**",
      "apps/site/.astro/**",
      "apps/site/.cache/**",
      "apps/site/dist/**",
      "apps/site/playwright-report/**",
      "apps/site/test-results/**",
      "apps/site/.lighthouseci/**"
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.ts", "packages/**/*.ts", "scripts/**/*.mjs", "tests/architecture/**/*.mjs"],
    rules: {
      "no-console": "off"
    }
  }
);
