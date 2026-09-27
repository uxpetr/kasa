// Kasa data model v0 (PLAN.md, Architecture). Change it only through a new
// migration: edit this file, then `pnpm db:generate`.
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const role = pgEnum("role", ["owner", "editor", "viewer"]);
export const botMode = pgEnum("bot_mode", ["off", "tagged", "proactive"]);
export const entryKind = pgEnum("entry_kind", [
  "note",
  "photo",
  "link",
  "capture",
  "drawing",
  "file",
  "decision",
  "bot",
]);
export const entrySource = pgEnum("entry_source", ["app", "extension", "telegram"]);
export const mediaRole = pgEnum("media_role", ["photo", "screenshot", "drawing-layer", "file"]);
export const actor = pgEnum("actor", ["bot", "user"]);
export const direction = pgEnum("direction", ["in", "out"]);
export const plan = pgEnum("plan", ["free", "owner"]);
export const uploadStatus = pgEnum("upload_status", ["pending", "processing", "ready", "failed"]);

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// users, sessions, accounts, and verifications follow Better Auth's model (D-127).
// The Google account id lives in accounts.account_id (provider_id = 'google').
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_provider_account_idx").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

// Short-lived tokens: OAuth state and the extension's one-time codes.
export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    name: text("name").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    botMode: botMode("bot_mode").notNull().default("tagged"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Soft delete: restorable for 30 days, then purged (D-015).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId)],
);

export const memberships = pgTable(
  "memberships",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: role("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // When the member last opened the feed; entries by others after this (or after joining) are unread.
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    // "Mute emails" in the project menu, or the unsubscribe link (D-165).
    emailsMuted: boolean("emails_muted").notNull().default(false),
    // At most one notification email per 15 minutes per project (P-12).
    lastEmailedAt: timestamp("last_emailed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const notificationKind = pgEnum("notification_kind", ["reply", "mention"]);

// Replies and @mentions waiting to be emailed (P-12). One per person per entry; a reply
// that also mentions its recipient counts as a reply.
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    createdAt: createdAt(),
    // Set when emailed, or when skipped (already read, deleted, muted).
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_user_entry_idx").on(t.userId, t.entryId),
    index("notifications_pending_idx").on(t.userId, t.projectId).where(sql`${t.handledAt} is null`),
  ],
);

// Pilot feedback from the account menu (D-181); emailed to Petr, listed at /feedback.
export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    // The path the dialog was opened on, e.g. "/".
    page: text("page"),
    createdAt: createdAt(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [index("feedback_created_idx").on(t.createdAt)],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Reusable by anyone with the link until it expires or is revoked (D-138).
    token: text("token").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_project_idx").on(t.projectId)],
);

export const entries = pgTable(
  "entries",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Null for Kasa Bot entries. Entries stay when their author leaves (D-015).
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    kind: entryKind("kind").notNull(),
    body: text("body"),
    source: entrySource("source").notNull().default("app"),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => entries.id, { onDelete: "set null" }),
    // Smart grouping (D-007): entries sharing a key render as one spread.
    groupKey: text("group_key"),
    // Kasa Bot cards with an action: "welcome" is the first card in My pile (D-180).
    botCard: text("bot_card"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Who deleted it, for the outline's wording (D-155); the author or the owner.
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    // Bumped by triggers whenever the entry, its reactions, or its comments change (P-06).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Feed paging per project; scanned backwards for newest first, id breaks ties (D-005).
    index("entries_feed_idx").on(t.projectId, t.createdAt, t.id),
    // Realtime back-fill: what changed in a project since a moment (P-06).
    index("entries_changes_idx").on(t.projectId, t.updatedAt),
    index("entries_reply_to_idx").on(t.replyToId),
  ],
);

export const entryMedia = pgTable(
  "entry_media",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    // The processed upload this came from; images are served through /api/media/<uploadId>.
    uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
    width: integer("width"),
    height: integer("height"),
    role: mediaRole("role").notNull(),
    position: integer("position").notNull().default(0),
  },
  // An upload becomes part of at most one entry.
  (t) => [index("entry_media_entry_idx").on(t.entryId), uniqueIndex("entry_media_upload_idx").on(t.uploadId)],
);

// A file on its way into the pile: presigned, uploaded, processed (F-06, D-132).
// Entries attach ready uploads as entry_media when they're created.
export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    status: uploadStatus("status").notNull().default("pending"),
    // Set once processing succeeds; the raw upload is deleted then.
    fullKey: text("full_key"),
    thumbKey: text("thumb_key"),
    width: integer("width"),
    height: integer("height"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("uploads_project_idx").on(t.projectId), index("uploads_status_idx").on(t.status, t.createdAt)],
);

export const linkPreviews = pgTable(
  "link_previews",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    siteName: text("site_name"),
    imageKey: text("image_key"),
    placeMeta: jsonb("place_meta"),
    videoMeta: jsonb("video_meta"),
  },
  (t) => [index("link_previews_entry_idx").on(t.entryId)],
);

// The full anchor is stored from day one so v2 can pin on live sites (D-011).
export const captures = pgTable("captures", {
  entryId: uuid("entry_id")
    .primaryKey()
    .references(() => entries.id, { onDelete: "cascade" }),
  pageUrl: text("page_url").notNull(),
  pageTitle: text("page_title"),
  selector: text("selector"),
  relX: doublePrecision("rel_x"),
  relY: doublePrecision("rel_y"),
  scrollY: doublePrecision("scroll_y"),
  viewport: jsonb("viewport"),
});

export const pins = pgTable(
  "pins",
  {
    id: id(),
    captureEntryId: uuid("capture_entry_id")
      .notNull()
      .references(() => captures.entryId, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    // Position on the screenshot, as fractions of its width and height.
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
  },
  (t) => [uniqueIndex("pins_capture_number_idx").on(t.captureEntryId, t.number)],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    pinId: uuid("pin_id").references(() => pins.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("comments_entry_idx").on(t.entryId, t.createdAt)],
);

export const reactions = pgTable(
  "reactions",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.userId, t.emoji] })],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: actor("created_by").notNull(),
  },
  (t) => [uniqueIndex("categories_project_name_idx").on(t.projectId, t.name)],
);

export const entryCategories = pgTable(
  "entry_categories",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    assignedBy: actor("assigned_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.categoryId] }), index("entry_categories_category_idx").on(t.categoryId)],
);

// One project maps to one Telegram group (PRD, Messenger integrations).
export const telegramLinks = pgTable("telegram_links", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull().unique(),
  linkedBy: uuid("linked_by")
    .notNull()
    .references(() => users.id),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const telegramMessages = pgTable(
  "telegram_messages",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    direction: direction("direction").notNull(),
  },
  // Loop prevention relies on each Telegram message mapping to one entry.
  (t) => [
    primaryKey({ columns: [t.chatId, t.messageId] }),
    index("telegram_messages_entry_idx").on(t.entryId),
  ],
);

export const telegramIdentities = pgTable("telegram_identities", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull().unique(),
});

export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: plan("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  status: text("status").notNull(),
});

export const projectPasses = pgTable(
  "project_passes",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    purchasedBy: uuid("purchased_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("project_passes_project_idx").on(t.projectId)],
);
