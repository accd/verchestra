import assert from "node:assert/strict";
import { test } from "node:test";

import { attachment, pageQuery, sourceFixture } from "../helpers/confluence-fixture.mjs";

const attachmentReads = (transport) => transport.calls.filter((call) => call.startsWith("attachment:"));

test("listed attachment content that the read no longer returns is refused as missing", async () => {
  const fixture = sourceFixture();
  fixture.transport.attachmentContents.delete("attachment:1:1");
  await assert.rejects(fixture.source.resolve(pageQuery()), {
    code: "VES_CONFLUENCE_ATTACHMENT_MISSING",
    message: "Confluence attachment content is missing"
  });
});

test("an attachment listed under another page is refused before its content is read", async () => {
  const fixture = sourceFixture();
  fixture.transport.attachments.set("page:1", [attachment(2, 1)]);
  await assert.rejects(fixture.source.resolve(pageQuery()), {
    code: "VES_CONFLUENCE_REMOTE_INVALID",
    message: "attachment crossed page boundary"
  });
  assert.deepEqual(attachmentReads(fixture.transport), []);
});

test("attachments are admitted and read one at a time, in identifier order", async () => {
  const fixture = sourceFixture();
  fixture.transport.attachments.set("page:1", [
    attachment(1, 2, { mediaType: "application/octet-stream" }),
    attachment(1, 1)
  ]);
  await assert.rejects(fixture.source.resolve(pageQuery()), {
    code: "VES_CONFLUENCE_ATTACHMENT_UNSUPPORTED",
    message: "Confluence attachment media type is not allowed"
  });
  // The supported attachment sorts first and is read before the second is refused.
  assert.deepEqual(attachmentReads(fixture.transport), ["attachment:attachment:1:1"]);
});

test("content whose byte count disagrees with its listed metadata is refused", async () => {
  const fixture = sourceFixture();
  const content = "# Architecture notes, longer than listed";
  fixture.transport.attachmentContents.set("attachment:1:1", {
    ...attachment(1, 1, { byteLength: Buffer.byteLength(content, "utf8") }),
    content
  });
  await assert.rejects(fixture.source.resolve(pageQuery()), {
    code: "VES_CONFLUENCE_ATTACHMENT_TOO_LARGE",
    message: "Confluence attachment bytes do not match the bounded metadata"
  });
});

test("content returned under a different revision is refused as substituted", async () => {
  const fixture = sourceFixture();
  fixture.transport.attachmentContents.set("attachment:1:1", {
    ...attachment(1, 1, { revision: "attachment-revision:other" }),
    content: "# Architecture notes"
  });
  await assert.rejects(fixture.source.resolve(pageQuery()), {
    code: "VES_CONFLUENCE_REMOTE_INVALID",
    message: "Confluence attachment identity was substituted"
  });
});
