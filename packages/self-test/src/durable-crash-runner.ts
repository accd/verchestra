// T71 Node-bound hard-crash facts. This adapter launches the repository-owned
// scenario child twice against the same disposable root: once with an injected
// hard crash and once in resume mode. It reports exit and persisted JSON facts;
// application owns every convergence and exactly-once verdict.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  type DurableBoundaryFact,
  type DurableCrashPhase,
  type FullDurableBoundaryId,
  type RootFacts
} from "@verchestra/application";
import { probeRootFacts } from "./disposable-roots.ts";

export type DurableCrashRunnerErrorCode =
  "VES_SELFTEST_CRASH_ENTRYPOINT_INVALID" | "VES_SELFTEST_CRASH_PROCESS_FAILED" | "VES_SELFTEST_CRASH_FACTS_INVALID";

export class DurableCrashRunnerError extends Error {
  readonly code: DurableCrashRunnerErrorCode;

  constructor(code: DurableCrashRunnerErrorCode, message: string) {
    super(message);
    this.name = "DurableCrashRunnerError";
    this.code = code;
  }
}

interface ProcessExitFact {
  readonly exitCode: number;
}

function fail(code: DurableCrashRunnerErrorCode, message: string): never {
  throw new DurableCrashRunnerError(code, message);
}

function childExit(
  executable: string,
  entrypoint: string,
  args: readonly string[],
  timeoutMs: number
): Promise<ProcessExitFact> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [entrypoint, ...args],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 65_536,
        env: { VERCHESTRA_SELF_TEST: "1" }
      },
      (error) => {
        if (error === null) {
          resolve(Object.freeze({ exitCode: 0 }));
          return;
        }
        if (typeof error.code === "number") {
          resolve(Object.freeze({ exitCode: error.code }));
          return;
        }
        reject(new DurableCrashRunnerError("VES_SELFTEST_CRASH_PROCESS_FAILED", "crash child did not exit cleanly"));
      }
    );
  });
}

function parsedBoundaryFact(value: unknown): Omit<DurableBoundaryFact, "crashExitCode" | "resumeExitCode"> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_SELFTEST_CRASH_FACTS_INVALID", "crash child facts are not an object");
  return value as Omit<DurableBoundaryFact, "crashExitCode" | "resumeExitCode">;
}

export class DurableCrashRunner {
  readonly #entrypoint: string;
  readonly #executable: string;
  readonly #timeoutMs: number;

  constructor(options: { readonly entrypoint: string; readonly executable?: string; readonly timeoutMs?: number }) {
    if (!isAbsolute(options.entrypoint))
      fail("VES_SELFTEST_CRASH_ENTRYPOINT_INVALID", "crash child entrypoint must be absolute");
    this.#entrypoint = options.entrypoint;
    this.#executable = options.executable ?? process.execPath;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async run(input: {
    readonly root: RootFacts;
    readonly boundaryId: FullDurableBoundaryId;
    readonly phase: DurableCrashPhase;
  }): Promise<DurableBoundaryFact> {
    // A caller may have already run the happy path (or another boundary) in
    // `input.root`.  Provisioning one nested root per matrix cell prevents a
    // crash case from inheriting completed production state.
    const casePath = await mkdtemp(join(input.root.realPath, ".verchestra-self-test-case-"));
    try {
      const caseRoot = await probeRootFacts(casePath);
      const factsDirectory = join(caseRoot.realPath, ".verchestra-self-test-crash");
      const factsPath = join(factsDirectory, `${input.boundaryId}-${input.phase}.json`);
      await mkdir(factsDirectory, { recursive: true });
      const common = [
        "--root",
        caseRoot.realPath,
        "--boundary",
        input.boundaryId,
        "--phase",
        input.phase,
        "--facts",
        factsPath
      ];
      const crash = await childExit(
        this.#executable,
        this.#entrypoint,
        [...common, "--mode", "crash"],
        this.#timeoutMs
      );
      const resume = await childExit(
        this.#executable,
        this.#entrypoint,
        [...common, "--mode", "resume"],
        this.#timeoutMs
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(factsPath, "utf8"));
      } catch {
        fail("VES_SELFTEST_CRASH_FACTS_INVALID", "crash child did not produce readable JSON facts");
      }
      return Object.freeze({
        ...parsedBoundaryFact(parsed),
        crashExitCode: crash.exitCode,
        resumeExitCode: resume.exitCode
      });
    } finally {
      await rm(casePath, { recursive: true, force: true });
    }
  }
}
