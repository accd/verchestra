# Probe host hardening (#570)

## Problem

The post-merge review of #424 (#553) found three low-severity gaps in the
out-of-process probe host:

1. **Two surviving mutants.** `detached: false` survived all 78 tests, because
   the reference worker exits on the end of its input; under that mutant a
   worker that ignores the end of its input outlives `VES_PROBE_TIMEOUT`. The
   `0700` directory and `0500` copy modes (T6) were untested: `0777` survived.
2. **The payload schema version was never checked.** The decoder requires only
   a version of at least 1, and `FramedProbeWorker` read version 99 as 1.
3. **Zeroization after a failed termination.** `execute` waited for the kill
   before zeroizing, so a termination that failed left the outbound parameter
   frame unzeroized and stderr unscrubbed.

Item 3 is fixed by #569 (#632): `execute` zeroizes and scrubs in a `finally`
whatever termination does, and its contract tests assert it. This change
covers items 1 and 2.

## Requirements

- **PHH-01**: A test SHALL kill the `detached: false` mutant: a worker that
  ignores the end of its input is still dead at the time bound.
- **PHH-02**: A test SHALL kill the `0777` mutants of the private directory and
  the private copy: the worker observes its directory as `0700` and its entry
  as `0500`.
- **PHH-03**: `FramedProbeWorker` SHALL refuse a frame under any payload schema
  version other than 1, with `VES_PROBE_PAYLOAD_SCHEMA_UNSUPPORTED`, terminating
  the worker and revoking the grant.

## Decisions

- **In the framed worker, not the decoder.** The decoder validates envelopes
  for every reader, and `verchestra-probe/1` leaves room for later payload
  versions. The framed worker is the reader that knows it speaks version 1, so
  it refuses the rest.
- **Observed by the worker.** The modes are asserted from inside the running
  worker (`report-environment`), which is what T6 is about, rather than by
  reading the host's private directory while it exists.
