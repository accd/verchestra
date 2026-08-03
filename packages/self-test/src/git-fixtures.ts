// T70: real, disposable Git repositories for the five workspace shapes
// (.specs/features/self-test-profiles/design.md). Every shape is provisioned
// under the T69 disposable root; this adapter only creates real `git init`
// repositories and reports paths — placement, initialization, bootstrap,
// sync, and reconciliation verdicts remain the scenario's (composition
// root's) job, exactly as AD-010 requires.
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RootFacts, WorkspaceShape } from "@verchestra/application";
import { normalizeFactPath } from "./disposable-roots.ts";
import type { BoundedFixtureFactory } from "./sentinels-and-fixtures.ts";

export interface GitFixtureFacts {
  readonly shape: WorkspaceShape;
  // The Git control root for this fixture — always a real repository.
  readonly controlRootPath: string;
  // The Project directory the shape exercises, or null for standalone (which
  // treats the control root itself as the one root Project).
  readonly projectPath: string | null;
}

// A hermetic Git environment: no system or operator global config, no
// credential helper, no terminal prompt. Fixtures must never read or write
// the real operator's Git identity or credentials (PRF-01).
function hermeticGitEnv(homeDirectory: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(homeDirectory, "gitconfig-selftest-empty"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: ""
  };
}

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export class GitFixtureFactory {
  readonly #root: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #fixtures: BoundedFixtureFactory;

  constructor(root: RootFacts, fixtures: BoundedFixtureFactory) {
    this.#root = root.canonicalPath;
    this.#env = hermeticGitEnv(join(this.#root, ".selftest-git-home"));
    this.#fixtures = fixtures;
  }

  async #initRepository(relativePath: string, files: Readonly<Record<string, string>>): Promise<string> {
    const absolute = join(this.#root, relativePath);
    await mkdir(absolute, { recursive: true });
    git(absolute, this.#env, "init", "--quiet", "--initial-branch=main");
    git(absolute, this.#env, "config", "user.name", "Verchestra Self-Test");
    git(absolute, this.#env, "config", "user.email", "self-test@invalid.example");
    for (const [path, content] of Object.entries(files)) {
      await this.#fixtures.write(join(relativePath, path), content);
    }
    git(absolute, this.#env, "add", ".");
    git(absolute, this.#env, "commit", "--quiet", "-m", "self-test fixture");
    // Every path this adapter reports is a fact, and T69's fact convention is
    // a normalized forward-slash path (`normalizeFactPath`). Returning a
    // platform-separator path makes `startsWith(root.canonicalPath)` false on
    // Windows even though the directory really is inside the root.
    return normalizeFactPath(absolute);
  }

  // Every shape gets its own subdirectory of the disposable root, so two
  // shapes provisioned from the same factory never share or contaminate one
  // another's Git state.
  async provision(shape: WorkspaceShape): Promise<GitFixtureFacts> {
    const base = shape;
    switch (shape) {
      case "standalone": {
        const controlRootPath = await this.#initRepository(base, { "package.json": rootPackage("standalone") });
        return Object.freeze({ shape, controlRootPath, projectPath: null });
      }
      case "colocated":
      case "centralized": {
        const controlRootPath = await this.#initRepository(base, { "package.json": rootPackage(shape) });
        const projectRelative = join(base, "projects/widget");
        await this.#fixtures.write(join(projectRelative, "package.json"), projectPackage(shape));
        git(controlRootPath, this.#env, "add", ".");
        git(controlRootPath, this.#env, "commit", "--quiet", "-m", `self-test ${shape} project`);
        return Object.freeze({
          shape,
          controlRootPath,
          projectPath: normalizeFactPath(join(this.#root, projectRelative))
        });
      }
      case "nested": {
        const controlRootPath = await this.#initRepository(base, { "package.json": rootPackage("nested") });
        const projectPath = await this.#initRepository(join(base, "projects/service"), {
          "package.json": projectPackage("nested")
        });
        return Object.freeze({ shape, controlRootPath, projectPath });
      }
      case "ignored": {
        const controlRootPath = await this.#initRepository(base, {
          "package.json": rootPackage("ignored"),
          ".gitignore": "projects/\n"
        });
        const projectPath = await this.#initRepository(join(base, "projects/service"), {
          "package.json": projectPackage("ignored")
        });
        return Object.freeze({ shape, controlRootPath, projectPath });
      }
    }
  }
}

function rootPackage(shape: WorkspaceShape): string {
  return `${JSON.stringify({ name: `selftest-control-${shape}`, private: true }, null, 2)}\n`;
}

function projectPackage(shape: WorkspaceShape): string {
  return `${JSON.stringify({ name: `selftest-project-${shape}`, private: true }, null, 2)}\n`;
}
