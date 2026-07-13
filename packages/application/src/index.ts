export const packageName = "@verchestra/application" as const;
export {
  BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS,
  BootstrapError,
  bootstrapPublicErrorRegistry
} from "./bootstrap/bootstrap-errors.ts";
export {
  MachineBootstrapService,
  type BootstrapResult,
  type CanonicalBootstrapConfig,
  type CanonicalDatabaseRegistration,
  type CanonicalSecretRequirement,
  type DriverDiscoveryPort,
  type LocalDriverCandidate,
  type LocalModelPassport,
  type MachineProfile,
  type MachineProfileSaveReceipt,
  type MachineProfileStorePort,
  type MissingBinding,
  type RoleBindingResult,
  type RoleRequirement,
  type SecretBindingInspectorPort,
  type SecretBindingRequest
} from "./bootstrap/machine-bootstrap.ts";
