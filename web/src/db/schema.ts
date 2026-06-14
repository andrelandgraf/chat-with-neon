import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

// Mirrors the function's schema (../../src/db/schema.ts). The web app reads chat
// history + profiles; the function writes new messages + profile pictures.
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("messages_created_at_idx").on(table.createdAt)],
);

export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  avatarUrl: text("avatar_url").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
