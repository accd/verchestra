import { ArchitectureConfluenceSource } from "../../packages/connectors/src/index.ts";

export const workspaceId = "workspace_018f0000-0000-7000-8000-000000000901";
export const sourceId = "confluence:architecture";

export const searchQuery = (overrides = {}) => ({
  workspaceId,
  selectorId: "selector_018f0000-0000-7000-8000-000000000902",
  sourceKind: "knowledge",
  sourceId,
  query: {
    scope: "project:core",
    spaceKey: "ARCH",
    mode: "search",
    terms: ["architecture", "requirements"],
    includeAttachments: true,
    pageSize: 2,
    maximumPages: 3,
    attachmentPageSize: 2,
    maximumAttachmentPages: 2,
    maximumAttachmentBytes: 4096,
    allowedAttachmentMediaTypes: ["text/markdown", "text/plain"]
  },
  ...overrides
});

export const pageQuery = (overrides = {}) => ({
  ...searchQuery(),
  query: {
    scope: "project:core",
    spaceKey: "ARCH",
    mode: "pages",
    pageIds: ["page:1", "page:2"],
    includeAttachments: true,
    pageSize: 2,
    maximumPages: 3,
    attachmentPageSize: 2,
    maximumAttachmentPages: 2,
    maximumAttachmentBytes: 4096,
    allowedAttachmentMediaTypes: ["text/markdown", "text/plain"]
  },
  ...overrides
});

export const page = (index, overrides = {}) => ({
  pageId: `page:${index}`,
  title: `Architecture ${index}`,
  body: `Architecture evidence ${index}`,
  revision: `revision:${index}`,
  webRef: `confluence:ARCH:page:${index}`,
  ...overrides
});

export const attachment = (pageIndex, index, overrides = {}) => ({
  attachmentId: `attachment:${pageIndex}:${index}`,
  pageId: `page:${pageIndex}`,
  title: `notes-${index}.md`,
  mediaType: "text/markdown",
  byteLength: 20,
  revision: `attachment-revision:${index}`,
  ...overrides
});

export class MockConfluenceReadTransport {
  constructor() {
    this.pages = new Map([
      ["page:1", page(1)],
      ["page:2", page(2)],
      ["page:3", page(3)]
    ]);
    this.attachments = new Map([
      ["page:1", [attachment(1, 1)]],
      ["page:2", []],
      ["page:3", []]
    ]);
    this.attachmentContents = new Map([
      [
        "attachment:1:1",
        {
          ...attachment(1, 1),
          content: "# Architecture notes"
        }
      ]
    ]);
    this.rate = { remaining: 100, retryAfterMs: 0 };
    this.pageSize = 2;
    this.attachmentPageSize = 2;
    this.calls = [];
  }

  async searchPages({ cursor, pageSize }) {
    this.calls.push(`search:${cursor ?? "start"}`);
    const values = [...this.pages.values()];
    const offset = cursor === undefined ? 0 : Number(cursor);
    const size = Math.min(pageSize, this.pageSize);
    return {
      pages: values.slice(offset, offset + size),
      nextCursor: offset + size < values.length ? String(offset + size) : undefined,
      rate: this.rate
    };
  }

  async getPage({ pageId }) {
    this.calls.push(`page:${pageId}`);
    return { page: this.pages.get(pageId), rate: this.rate };
  }

  async listAttachments({ pageId, cursor, pageSize }) {
    this.calls.push(`attachments:${pageId}:${cursor ?? "start"}`);
    const values = this.attachments.get(pageId) ?? [];
    const offset = cursor === undefined ? 0 : Number(cursor);
    const size = Math.min(pageSize, this.attachmentPageSize);
    return {
      attachments: values.slice(offset, offset + size),
      nextCursor: offset + size < values.length ? String(offset + size) : undefined,
      rate: this.rate
    };
  }

  async readAttachment({ attachmentId }) {
    this.calls.push(`attachment:${attachmentId}`);
    return { attachment: this.attachmentContents.get(attachmentId), rate: this.rate };
  }
}

export function sourceFixture(overrides = {}) {
  const transport = overrides.transport ?? new MockConfluenceReadTransport();
  const source = new ArchitectureConfluenceSource({
    transport,
    workspaceId,
    sourceId,
    spaceKey: "ARCH",
    classification: "internal",
    now: () => "2026-07-15T12:00:00.000Z",
    ...overrides,
    transport: overrides.transport ?? transport
  });
  return { transport, source };
}
