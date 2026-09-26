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
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // Feed paging per project; scanned backwards for newest first, id breaks ties (D-005).
    index("entries_feed_idx").on(t.projectId, t.createdAt, t.id),
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
    width: integer("width"),
    height: integer("height"),
    role: mediaRole("role").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("entry_media_entry_idx").on(t.entryId)],
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
