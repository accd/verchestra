export interface CliCommand {
  readonly name: string;
  readonly options: Readonly<Record<string, string | boolean>>;
}

export interface InvocationContext {
  readonly canonicalExecutable: "vestra";
  readonly output: "human" | "json";
  // null in source mode: no verified release artifact exists to bind a digest
  // to, and a command must be able to tell that apart from a real release.
  readonly releaseDigest: string | null;
}

export interface CommandResult {
  readonly data: unknown;
  readonly diagnostics: readonly string[];
  // A command that ran successfully but wants to signal a health state (a
  // diagnostic reporting FAIL or BLOCKED) sets a non-zero exit while still
  // rendering its data. Omitted means success exits 0, as before.
  readonly exitCode?: number;
}

export interface CommandBus {
  execute(command: CliCommand, context: InvocationContext): Promise<CommandResult>;
}
