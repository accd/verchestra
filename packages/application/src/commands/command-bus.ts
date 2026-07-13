export interface CliCommand {
  readonly name: string;
  readonly options: Readonly<Record<string, string | boolean>>;
}

export interface InvocationContext {
  readonly canonicalExecutable: "vestra";
  readonly output: "human" | "json";
  readonly releaseDigest: string;
}

export interface CommandResult {
  readonly data: unknown;
  readonly diagnostics: readonly string[];
}

export interface CommandBus {
  execute(command: CliCommand, context: InvocationContext): Promise<CommandResult>;
}
