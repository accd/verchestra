export class SyncError extends Error {
  readonly code: string;
  readonly minimumCompatibleRelease: string | undefined;

  constructor(
    code: string,
    message: string,
    details: { readonly minimumCompatibleRelease?: string } = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SyncError";
    this.code = code;
    this.minimumCompatibleRelease = details.minimumCompatibleRelease;
  }
}
