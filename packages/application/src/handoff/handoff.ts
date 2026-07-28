// Public surface of the portable handoff boundary. The implementation is split
// by concern: errors, generic validators, structural contracts, normalizers,
// and the coordinator state machine.

export { HandoffError, type HandoffErrorCode } from "./errors.ts";
export { PortableHandoffCoordinator } from "./coordinator.ts";
export type { HandoffPorts } from "./types.ts";
