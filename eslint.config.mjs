import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
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
      "apps/site/.lighthouseci/**",
      // why: `corepack pnpm build:probe-worker` writes a minified, git-ignored
      // bundle here; it is build output, never source (AGENTS.md).
      "apps/vestra-cli/dist/**"
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
