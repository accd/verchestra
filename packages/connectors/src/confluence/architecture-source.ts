import { createHash } from "node:crypto";

import type {
  ContextClaimInput,
  ContextFragmentInput,
  ContextSourceObservation,
  ContextSourcePort,
  ContextSourceQuery
} from "@verchestra/application";
import {
  DataClassification,
  IsoInstant,
  StableId,
  canonicalizeJsonV2,
  normalizeDeclaredSet,
  type DataClassificationValue
} from "@verchestra/domain";

export const ARCHITECTURE_CONFLUENCE_CAPABILITIES = Object.freeze(["search", "page-read", "attachment-read"] as const);

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9:._/@+\-]{0,511}$/u;
const SPACE_KEY = /^[A-Z][A-Z0-9_]{1,31}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_PAGE_BODY_BYTES = 1_000_000;
const MAX_PAGES_PER_RESOLUTION = 200;
const MAX_FRAGMENTS_PER_RESOLUTION = 400;

export class ConfluenceConnectorError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfluenceConnectorError";
    this.code = code;
  }
}

type JsonRecord = Readonly<Record<string, unknown>> &
  Readonly<{
    workspaceId?: unknown;
    selectorId?: unknown;
    sourceKind?: unknown;
    sourceId?: unknown;
    query?: unknown;
    expectedRevision?: unknown;
    scope?: unknown;
    spaceKey?: unknown;
    mode?: unknown;
    terms?: unknown;
    pageIds?: unknown;
    includeAttachments?: unknown;
    pageSize?: unknown;
    maximumPages?: unknown;
    attachmentPageSize?: unknown;
    maximumAttachmentPages?: unknown;
    maximumAttachmentBytes?: unknown;
    allowedAttachmentMediaTypes?: unknown;
    pages?: unknown;
    page?: unknown;
    nextCursor?: unknown;
    rate?: unknown;
    remaining?: unknown;
    retryAfterMs?: unknown;
    pageId?: unknown;
    title?: unknown;
    body?: unknown;
    revision?: unknown;
    webRef?: unknown;
    attachments?: unknown;
    attachment?: unknown;
    attachmentId?: unknown;
    mediaType?: unknown;
    byteLength?: unknown;
    content?: unknown;
  }>;

export interface ConfluenceReadTransport {
  searchPages(input: {
    readonly spaceKey: string;
    readonly terms: readonly string[];
    readonly pageSize: number;
    readonly cursor?: string;
  }): Promise<unknown>;
  getPage(input: { readonly spaceKey: string; readonly pageId: string }): Promise<unknown>;
  listAttachments(input: {
    readonly spaceKey: string;
    readonly pageId: string;
    readonly pageSize: number;
    readonly cursor?: string;
  }): Promise<unknown>;
  readAttachment(input: {
    readonly spaceKey: string;
    readonly pageId: string;
    readonly attachmentId: string;
    readonly maximumBytes: number;
  }): Promise<unknown>;
}

interface NormalizedQuery {
  readonly scope: string;
  readonly spaceKey: string;
  readonly mode: "search" | "pages";
  readonly terms?: readonly string[];
  readonly pageIds?: readonly string[];
  readonly includeAttachments: boolean;
  readonly pageSize: number;
  readonly maximumPages: number;
  readonly attachmentPageSize: number;
  readonly maximumAttachmentPages: number;
  readonly maximumAttachmentBytes: number;
  readonly allowedAttachmentMediaTypes: readonly string[];
}

interface RemotePage {
  readonly pageId: string;
  readonly title: string;
  readonly body: string;
  readonly revision: string;
  readonly webRef: string;
}

interface RemoteAttachmentMetadata {
  readonly attachmentId: string;
  readonly pageId: string;
  readonly title: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly revision: string;
}

interface RemoteAttachment extends RemoteAttachmentMetadata {
  readonly content: string;
}

interface RateState {
  readonly remaining: number;
  readonly retryAfterMs: number;
}

const asRecord = (value: unknown, code: string, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfluenceConnectorError(code, `${label} must be an object`);
  }
  return value as JsonRecord;
};

const exactKeys = (value: JsonRecord, expected: readonly string[], code: string, label: string): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new ConfluenceConnectorError(code, `${label} has missing or unknown fields`);
  }
};

const safeToken = (value: unknown, code: string, label: string, pattern = SAFE_TOKEN): string => {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ConfluenceConnectorError(code, `${label} is invalid`);
  }
  return value;
};

const boundedText = (value: unknown, code: string, label: string, maximumBytes: number): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw new ConfluenceConnectorError(code, `${label} is outside bounded text limits`);
  }
  return value;
};

const boundedInteger = (value: unknown, code: string, label: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new ConfluenceConnectorError(code, `${label} must be from 1 through ${maximum}`);
  }
  return value as number;
};

// A string argument stays a raw-byte digest of the string itself (page bodies
// and attachment content), not a digest of its JSON encoding. Every structured
// argument is encoded by the shared RFC 8785 canonicalizer instead of the
// private recursive serializer this file used to carry, whose member ordering
// went through the ambient locale (issue #58).
const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonicalizeJsonV2(value), "utf8")
    .digest("hex")}`;

const stableFragmentId = (material: unknown): string => {
  const hex = sha256(material).slice("sha256:".length);
  return `fragment_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const canonicalStrings = (
  value: unknown,
  code: string,
  label: string,
  options: { readonly maximumItems: number; readonly pattern?: RegExp; readonly text?: boolean }
): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > options.maximumItems) {
    throw new ConfluenceConnectorError(code, `${label} is invalid`);
  }
  const values = value.map((entry, index) =>
    options.text === true
      ? boundedText(entry, code, `${label}[${index}]`, 200)
      : safeToken(entry, code, `${label}[${index}]`, options.pattern)
  );
  if (new Set(values).size !== values.length) throw new ConfluenceConnectorError(code, `${label} contains duplicates`);
  return Object.freeze([...values].sort());
};

const normalizeRate = (value: unknown): RateState => {
  const code = "VES_CONFLUENCE_REMOTE_INVALID";
  const record = asRecord(value, code, "Confluence rate state");
  exactKeys(record, ["remaining", "retryAfterMs"], code, "Confluence rate state");
  if (
    !Number.isSafeInteger(record.remaining) ||
    !Number.isSafeInteger(record.retryAfterMs) ||
    (record.retryAfterMs as number) < 0
  ) {
    throw new ConfluenceConnectorError(code, "Confluence rate state is invalid");
  }
  const rate = { remaining: record.remaining as number, retryAfterMs: record.retryAfterMs as number };
  if (rate.remaining <= 0) {
    throw new ConfluenceConnectorError(
      "VES_CONFLUENCE_RATE_LIMITED",
      `Confluence rate budget is exhausted; retry after ${rate.retryAfterMs}ms`
    );
  }
  return Object.freeze(rate);
};

const normalizePage = (value: unknown): RemotePage => {
  const code = "VES_CONFLUENCE_REMOTE_INVALID";
  const record = asRecord(value, code, "Confluence page");
  exactKeys(record, ["pageId", "title", "body", "revision", "webRef"], code, "Confluence page");
  return Object.freeze({
    pageId: safeToken(record.pageId, code, "pageId"),
    title: boundedText(record.title, code, "page title", 500),
    body: boundedText(record.body, code, "page body", MAX_PAGE_BODY_BYTES),
    revision: safeToken(record.revision, code, "page revision"),
    webRef: safeToken(record.webRef, code, "page webRef")
  });
};

const normalizeAttachmentMetadata = (value: unknown): RemoteAttachmentMetadata => {
  const code = "VES_CONFLUENCE_REMOTE_INVALID";
  const record = asRecord(value, code, "Confluence attachment metadata");
  exactKeys(
    record,
    ["attachmentId", "pageId", "title", "mediaType", "byteLength", "revision"],
    code,
    "Confluence attachment metadata"
  );
  if (!Number.isSafeInteger(record.byteLength) || (record.byteLength as number) < 1) {
    throw new ConfluenceConnectorError(code, "attachment byteLength is invalid");
  }
  return Object.freeze({
    attachmentId: safeToken(record.attachmentId, code, "attachmentId"),
    pageId: safeToken(record.pageId, code, "attachment pageId"),
    title: boundedText(record.title, code, "attachment title", 500),
    mediaType: safeToken(record.mediaType, code, "attachment mediaType", MEDIA_TYPE),
    byteLength: record.byteLength as number,
    revision: safeToken(record.revision, code, "attachment revision")
  });
};

const normalizeAttachment = (value: unknown): RemoteAttachment => {
  const code = "VES_CONFLUENCE_REMOTE_INVALID";
  const record = asRecord(value, code, "Confluence attachment");
  exactKeys(
    record,
    ["attachmentId", "pageId", "title", "mediaType", "byteLength", "revision", "content"],
    code,
    "Confluence attachment"
  );
  const metadata = normalizeAttachmentMetadata({
    attachmentId: record.attachmentId,
    pageId: record.pageId,
    title: record.title,
    mediaType: record.mediaType,
    byteLength: record.byteLength,
    revision: record.revision
  });
  return Object.freeze({
    ...metadata,
    content: boundedText(record.content, code, "attachment content", Math.max(metadata.byteLength, 1))
  });
};

const claim = (factKey: string, value: string): ContextClaimInput => Object.freeze({ factKey, value });

const pageFragment = (page: RemotePage, classification: DataClassificationValue): ContextFragmentInput =>
  Object.freeze({
    fragmentId: stableFragmentId({
      kind: "page",
      pageId: page.pageId,
      revision: page.revision,
      content: sha256(page.body)
    }),
    content: page.body,
    classification,
    trust: "untrusted-data",
    claims: Object.freeze([
      claim("confluence:resource-kind", "page"),
      claim("confluence:page-id", page.pageId),
      claim("confluence:title", page.title),
      claim("confluence:web-ref", page.webRef)
    ])
  });

const attachmentFragment = (
  attachment: RemoteAttachment,
  classification: DataClassificationValue
): ContextFragmentInput =>
  Object.freeze({
    fragmentId: stableFragmentId({
      kind: "attachment",
      attachmentId: attachment.attachmentId,
      revision: attachment.revision,
      content: sha256(attachment.content)
    }),
    content: attachment.content,
    classification,
    trust: "untrusted-data",
    claims: Object.freeze([
      claim("confluence:resource-kind", "attachment"),
      claim("confluence:page-id", attachment.pageId),
      claim("confluence:attachment-id", attachment.attachmentId),
      claim("confluence:title", attachment.title),
      claim("confluence:media-type", attachment.mediaType)
    ])
  });

export class ArchitectureConfluenceSource implements ContextSourcePort {
  readonly #transport: ConfluenceReadTransport;
  readonly #workspaceId: string;
  readonly #sourceId: string;
  readonly #spaceKey: string;
  readonly #classification: DataClassificationValue;
  readonly #now: () => string;

  constructor(options: {
    readonly transport: ConfluenceReadTransport;
    readonly workspaceId: string;
    readonly sourceId: string;
    readonly spaceKey: string;
    readonly classification: DataClassificationValue;
    readonly now?: () => string;
  }) {
    try {
      StableId.parse(options.workspaceId, "workspace");
      this.#sourceId = safeToken(options.sourceId, "VES_CONFLUENCE_CONFIG_INVALID", "sourceId");
      this.#spaceKey = safeToken(options.spaceKey, "VES_CONFLUENCE_CONFIG_INVALID", "spaceKey", SPACE_KEY);
      this.#classification = DataClassification.parse(options.classification).value;
    } catch (error) {
      if (error instanceof ConfluenceConnectorError) throw error;
      throw new ConfluenceConnectorError("VES_CONFLUENCE_CONFIG_INVALID", "Confluence source configuration is invalid");
    }
    this.#transport = options.transport;
    this.#workspaceId = options.workspaceId;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async resolve(value: ContextSourceQuery): Promise<ContextSourceObservation | undefined> {
    const query = this.#normalizeRequest(value);
    const retrievedAt = this.#retrievedAt();
    const pages = query.mode === "search" ? await this.#search(query) : await this.#pages(query);
    if (pages.length === 0) return undefined;
    const fragments: ContextFragmentInput[] = pages.map((entry) => pageFragment(entry, this.#classification));
    const attachmentRevisions: Readonly<Record<string, unknown>>[] = [];
    if (query.includeAttachments) {
      for (const current of pages) {
        const attachments = await this.#attachments(current, query);
        for (const attachment of attachments) {
          fragments.push(attachmentFragment(attachment, this.#classification));
          attachmentRevisions.push({
            attachmentId: attachment.attachmentId,
            pageId: attachment.pageId,
            revision: attachment.revision,
            contentDigest: sha256(attachment.content)
          });
        }
      }
    }
    if (fragments.length > MAX_FRAGMENTS_PER_RESOLUTION) {
      throw new ConfluenceConnectorError(
        "VES_CONFLUENCE_RESULT_LIMIT",
        "Confluence result exceeded the fragment bound"
      );
    }
    // Both collections are declared sets: the observation's fragment order and
    // the revision digest's attachment order are ours, not Confluence's, so
    // they must be reproduced identically on every machine (issue #58).
    const orderedFragments = normalizeDeclaredSet(fragments, (entry) => entry.fragmentId);
    const revision = sha256({
      schemaVersion: 1,
      sourceId: this.#sourceId,
      spaceKey: this.#spaceKey,
      pages: pages.map((entry) => ({
        pageId: entry.pageId,
        revision: entry.revision,
        contentDigest: sha256(entry.body)
      })),
      attachments: normalizeDeclaredSet(attachmentRevisions, (entry) => canonicalizeJsonV2(entry))
    });
    if (!DIGEST.test(revision))
      throw new ConfluenceConnectorError("VES_CONFLUENCE_REMOTE_INVALID", "revision digest is invalid");
    return Object.freeze({
      source: Object.freeze({ kind: "knowledge", identity: this.#sourceId, revision }),
      retrievedAt,
      scope: query.scope,
      fragments: Object.freeze(orderedFragments)
    });
  }

  #normalizeRequest(value: ContextSourceQuery): NormalizedQuery {
    const code = "VES_CONFLUENCE_QUERY_INVALID";
    const request = asRecord(value, code, "Confluence source request");
    const requestKeys = ["workspaceId", "selectorId", "sourceKind", "sourceId", "query"];
    if (Object.hasOwn(request, "expectedRevision")) requestKeys.push("expectedRevision");
    exactKeys(request, requestKeys, code, "Confluence source request");
    try {
      StableId.parse(safeToken(request.workspaceId, code, "workspaceId"), "workspace");
      StableId.parse(safeToken(request.selectorId, code, "selectorId"), "selector");
    } catch {
      throw new ConfluenceConnectorError(code, "Confluence source identity is invalid");
    }
    if (
      request.workspaceId !== this.#workspaceId ||
      request.sourceKind !== "knowledge" ||
      request.sourceId !== this.#sourceId
    ) {
      throw new ConfluenceConnectorError(code, "Confluence source request is outside configured authority");
    }
    if (request.expectedRevision !== undefined) safeToken(request.expectedRevision, code, "expectedRevision");
    const input = asRecord(request.query, code, "Confluence selector query");
    const mode = safeToken(input.mode, code, "mode");
    const common = [
      "scope",
      "spaceKey",
      "mode",
      "includeAttachments",
      "pageSize",
      "maximumPages",
      "attachmentPageSize",
      "maximumAttachmentPages",
      "maximumAttachmentBytes",
      "allowedAttachmentMediaTypes"
    ];
    exactKeys(input, [...common, mode === "search" ? "terms" : "pageIds"], code, "Confluence selector query");
    if (mode !== "search" && mode !== "pages") throw new ConfluenceConnectorError(code, "mode is invalid");
    if (input.spaceKey !== this.#spaceKey)
      throw new ConfluenceConnectorError(code, "selector space is outside configured authority");
    if (typeof input.includeAttachments !== "boolean")
      throw new ConfluenceConnectorError(code, "includeAttachments is invalid");
    const media = canonicalStrings(input.allowedAttachmentMediaTypes, code, "allowedAttachmentMediaTypes", {
      maximumItems: 20,
      pattern: MEDIA_TYPE
    });
    return Object.freeze({
      scope: safeToken(input.scope, code, "scope"),
      spaceKey: this.#spaceKey,
      mode,
      ...(mode === "search"
        ? { terms: canonicalStrings(input.terms, code, "terms", { maximumItems: 20, text: true }) }
        : { pageIds: canonicalStrings(input.pageIds, code, "pageIds", { maximumItems: 100 }) }),
      includeAttachments: input.includeAttachments,
      pageSize: boundedInteger(input.pageSize, code, "pageSize", 100),
      maximumPages: boundedInteger(input.maximumPages, code, "maximumPages", 100),
      attachmentPageSize: boundedInteger(input.attachmentPageSize, code, "attachmentPageSize", 100),
      maximumAttachmentPages: boundedInteger(input.maximumAttachmentPages, code, "maximumAttachmentPages", 100),
      maximumAttachmentBytes: boundedInteger(input.maximumAttachmentBytes, code, "maximumAttachmentBytes", 1_000_000),
      allowedAttachmentMediaTypes: media
    });
  }

  #retrievedAt(): string {
    try {
      return IsoInstant.parse(this.#now()).value;
    } catch {
      throw new ConfluenceConnectorError("VES_CONFLUENCE_CLOCK_INVALID", "Confluence retrieval clock is invalid");
    }
  }

  async #search(query: NormalizedQuery): Promise<readonly RemotePage[]> {
    const pages: RemotePage[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < query.maximumPages; pageIndex += 1) {
      const response = await this.#call(() =>
        this.#transport.searchPages({
          spaceKey: this.#spaceKey,
          terms: query.terms ?? [],
          pageSize: query.pageSize,
          ...(cursor === undefined ? {} : { cursor })
        })
      );
      exactKeys(
        response,
        ["pages", "nextCursor", "rate"],
        "VES_CONFLUENCE_REMOTE_INVALID",
        "Confluence search response"
      );
      normalizeRate(response.rate);
      if (!Array.isArray(response.pages))
        throw new ConfluenceConnectorError("VES_CONFLUENCE_REMOTE_INVALID", "search pages are invalid");
      pages.push(...response.pages.map(normalizePage));
      if (pages.length > MAX_PAGES_PER_RESOLUTION) {
        throw new ConfluenceConnectorError("VES_CONFLUENCE_RESULT_LIMIT", "Confluence result exceeded the page bound");
      }
      if (response.nextCursor === undefined) return this.#canonicalPages(pages);
      const next = safeToken(response.nextCursor, "VES_CONFLUENCE_PAGINATION_INVALID", "search nextCursor");
      if (seenCursors.has(next))
        throw new ConfluenceConnectorError("VES_CONFLUENCE_PAGINATION_INVALID", "search cursor repeated");
      seenCursors.add(next);
      cursor = next;
    }
    throw new ConfluenceConnectorError("VES_CONFLUENCE_PAGINATION_LIMIT", "search exceeded the configured page bound");
  }

  async #pages(query: NormalizedQuery): Promise<readonly RemotePage[]> {
    const pages: RemotePage[] = [];
    for (const pageId of query.pageIds ?? []) {
      const response = await this.#call(() => this.#transport.getPage({ spaceKey: this.#spaceKey, pageId }));
      exactKeys(response, ["page", "rate"], "VES_CONFLUENCE_REMOTE_INVALID", "Confluence page response");
      normalizeRate(response.rate);
      if (response.page === undefined)
        throw new ConfluenceConnectorError("VES_CONFLUENCE_PAGE_MISSING", "Requested Confluence page is missing");
      const current = normalizePage(response.page);
      if (current.pageId !== pageId)
        throw new ConfluenceConnectorError("VES_CONFLUENCE_REMOTE_INVALID", "Confluence page identity was substituted");
      pages.push(current);
    }
    return this.#canonicalPages(pages);
  }

  #canonicalPages(pages: readonly RemotePage[]): readonly RemotePage[] {
    // Declared set: this order is what the revision digest's `pages` array
    // records, so it cannot follow the ambient locale (issue #58).
    const sorted = normalizeDeclaredSet(pages, (entry) => entry.pageId);
    if (new Set(sorted.map((entry) => entry.pageId)).size !== sorted.length) {
      throw new ConfluenceConnectorError(
        "VES_CONFLUENCE_REMOTE_INVALID",
        "Confluence returned duplicate page identity"
      );
    }
    return Object.freeze(sorted);
  }

  async #attachments(page: RemotePage, query: NormalizedQuery): Promise<readonly RemoteAttachment[]> {
    const metadata: RemoteAttachmentMetadata[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < query.maximumAttachmentPages; pageIndex += 1) {
      const response = await this.#call(() =>
        this.#transport.listAttachments({
          spaceKey: this.#spaceKey,
          pageId: page.pageId,
          pageSize: query.attachmentPageSize,
          ...(cursor === undefined ? {} : { cursor })
        })
      );
      exactKeys(
        response,
        ["attachments", "nextCursor", "rate"],
        "VES_CONFLUENCE_REMOTE_INVALID",
        "Confluence attachment list response"
      );
      normalizeRate(response.rate);
      if (!Array.isArray(response.attachments)) {
        throw new ConfluenceConnectorError("VES_CONFLUENCE_REMOTE_INVALID", "attachment list is invalid");
      }
      metadata.push(...response.attachments.map(normalizeAttachmentMetadata));
      if (response.nextCursor === undefined) break;
      const next = safeToken(response.nextCursor, "VES_CONFLUENCE_PAGINATION_INVALID", "attachment nextCursor");
      if (seenCursors.has(next)) {
        throw new ConfluenceConnectorError("VES_CONFLUENCE_PAGINATION_INVALID", "attachment cursor repeated");
      }
      seenCursors.add(next);
      cursor = next;
      if (pageIndex === query.maximumAttachmentPages - 1) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_PAGINATION_LIMIT",
          "attachments exceeded the configured page bound"
        );
      }
    }
    // Declared set: this order decides the sequence attachment content is read
    // and validated in, so it is observable behavior (which bounded-attachment
    // failure surfaces first) as well as digest input (issue #58).
    const ordered = normalizeDeclaredSet(metadata, (entry) => entry.attachmentId);
    if (new Set(ordered.map((entry) => entry.attachmentId)).size !== ordered.length) {
      throw new ConfluenceConnectorError(
        "VES_CONFLUENCE_REMOTE_INVALID",
        "Confluence returned duplicate attachment identity"
      );
    }
    const result: RemoteAttachment[] = [];
    for (const item of ordered) {
      if (item.pageId !== page.pageId)
        throw new ConfluenceConnectorError("VES_CONFLUENCE_REMOTE_INVALID", "attachment crossed page boundary");
      if (!query.allowedAttachmentMediaTypes.includes(item.mediaType)) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_ATTACHMENT_UNSUPPORTED",
          "Confluence attachment media type is not allowed"
        );
      }
      if (item.byteLength > query.maximumAttachmentBytes) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_ATTACHMENT_TOO_LARGE",
          "Confluence attachment exceeds the configured byte bound"
        );
      }
      const response = await this.#call(() =>
        this.#transport.readAttachment({
          spaceKey: this.#spaceKey,
          pageId: page.pageId,
          attachmentId: item.attachmentId,
          maximumBytes: query.maximumAttachmentBytes
        })
      );
      exactKeys(response, ["attachment", "rate"], "VES_CONFLUENCE_REMOTE_INVALID", "Confluence attachment response");
      normalizeRate(response.rate);
      if (response.attachment === undefined) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_ATTACHMENT_MISSING",
          "Confluence attachment content is missing"
        );
      }
      const attachment = normalizeAttachment(response.attachment);
      if (
        attachment.attachmentId !== item.attachmentId ||
        attachment.pageId !== page.pageId ||
        attachment.title !== item.title ||
        attachment.mediaType !== item.mediaType ||
        attachment.revision !== item.revision
      ) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_REMOTE_INVALID",
          "Confluence attachment identity was substituted"
        );
      }
      if (
        attachment.byteLength !== item.byteLength ||
        Buffer.byteLength(attachment.content, "utf8") !== attachment.byteLength ||
        attachment.byteLength > query.maximumAttachmentBytes
      ) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_ATTACHMENT_TOO_LARGE",
          "Confluence attachment bytes do not match the bounded metadata"
        );
      }
      result.push(attachment);
    }
    return Object.freeze(result);
  }

  async #call(operation: () => Promise<unknown>): Promise<JsonRecord> {
    try {
      return asRecord(await operation(), "VES_CONFLUENCE_REMOTE_INVALID", "Confluence transport response");
    } catch (error) {
      if (error instanceof ConfluenceConnectorError) throw error;
      const statusCode = (error as { readonly statusCode?: unknown })?.statusCode;
      if (statusCode === 401 || statusCode === 403) {
        throw new ConfluenceConnectorError(
          "VES_CONFLUENCE_AUTH_FAILED",
          "Confluence authentication or authorization failed"
        );
      }
      throw new ConfluenceConnectorError("VES_CONFLUENCE_UNAVAILABLE", "Confluence read transport is unavailable");
    }
  }
}
