# OpenCode Pre-Prompt Cancellation Specification

**Issue:** #109
**Status:** In implementation

## Problem

The OpenCode qualification sensor used a 30 ms timer to request cancellation.
The timer can fire after a fast runner has already dispatched a prompt, so the
test conflates scheduling speed with the pre-prompt cancellation contract.

## Requirement

When cancellation is observed after SDK session creation but before prompt
dispatch, the driver shall abort that session before closing its loopback
server and shall not dispatch a prompt.

## Non-goals

- Do not change production driver behavior or reduce cancellation coverage.
- Do not require an OpenCode binary, a provider session, or network access.
