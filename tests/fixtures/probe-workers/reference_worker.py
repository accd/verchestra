# why: a second-language `verchestra-probe/1` worker proves the contract is
# language-neutral. It uses only the Python 3 standard library that a stock
# macOS or Linux CI runner ships, and it implements the frame, the RFC 8785
# payload digest (for the JSON subset the protocol uses: objects, arrays,
# strings, integers, booleans, null), and the Workspace binding from the
# published contract alone. Its identity, session evidence, and rows are
# synthetic; it is a protocol reference, not a database driver.
import base64
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

WORKSPACE_ID = os.environ.get("VERCHESTRA_PROBE_WORKSPACE_ID")
COMPONENT_ID = os.environ.get("PROBE_FIXTURE_COMPONENT", "plugin:acme-orders-probe-python")

with open(sys.argv[0], "rb") as handle:
    OWN_DIGEST = "sha256:" + hashlib.sha256(handle.read()).hexdigest()


def code_units(key):
    # invariant: RFC 8785 orders object keys by UTF-16 code units. Python's str
    # order is by code point, which differs for keys above the BMP (a surrogate
    # pair sorts below U+E000..U+FFFF), so the key is compared as UTF-16BE bytes.
    return key.encode("utf-16-be", "surrogatepass")


def canonical(value):
    if isinstance(value, dict):
        keys = sorted(value, key=code_units)
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + canonical(value[key]) for key in keys) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def digest(value):
    return "sha256:" + hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


class Channel:
    def __init__(self):
        self.sequence = 0

    def send(self, name, payload):
        now = datetime.now(timezone.utc)
        envelope = {
            "protocol": "verchestra-probe/1",
            "messageId": "worker:%d" % self.sequence,
            "correlationId": "probe-channel:python",
            "workspaceId": WORKSPACE_ID,
            "sequence": self.sequence,
            "sentAt": now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000),
            "payloadSchema": {"name": name, "version": 1},
            "payloadDigest": digest(payload),
            "payload": payload,
        }
        self.sequence += 1
        body = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        sys.stdout.buffer.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        sys.stdout.buffer.flush()


def read_frame(stream):
    header = b""
    while not header.endswith(b"\r\n\r\n"):
        byte = stream.read(1)
        if not byte:
            return None
        header += byte
        if len(header) > 64:
            sys.exit(2)
    name, _, value = header[:-4].decode("ascii").partition(":")
    if name != "Content-Length" or not value.strip().isdigit():
        sys.exit(2)
    body = stream.read(int(value.strip()))
    return json.loads(body.decode("utf-8"))


def main():
    channel = Channel()
    stream = sys.stdin.buffer
    while True:
        envelope = read_frame(stream)
        if envelope is None:
            return 0
        if envelope["workspaceId"] != WORKSPACE_ID or envelope["payloadDigest"] != digest(envelope["payload"]):
            return 3
        name = envelope["payloadSchema"]["name"]
        payload = envelope["payload"]
        if name == "probe.hello":
            channel.send("probe.handshake", {
                "protocol": "verchestra-probe/1",
                "supportedSchemas": ["probe.plan/1", "probe.result/1"],
                "component": {"id": COMPONENT_ID, "digest": OWN_DIGEST},
                "capabilities": ["database-read"],
                "maximumMessageBytes": 65536,
            })
        elif name == "probe.identity.request":
            channel.send("probe.identity", {"evidence": {
                "databaseId": payload["plan"]["databaseId"],
                "principalReadOnly": True,
                "principalFingerprint": digest({"principal": "fixture-read-only"}),
            }})
        elif name == "probe.session.request":
            channel.send("probe.session", {
                "planDigest": payload["plan"]["planDigest"],
                "sessionReadOnly": True,
                "transactionReadOnly": True,
            })
        elif name == "probe.execute":
            parameters = base64.b64decode(payload["parameters"])
            channel.send("probe.result.chunk", {"rows": [{"id": 1, "language": "python", "parameterBytes": len(parameters)}]})
            channel.send("probe.result.end", {"chunkCount": 1})
        elif name == "probe.cancel":
            return 0
        else:
            return 4


if __name__ == "__main__":
    sys.exit(main())
