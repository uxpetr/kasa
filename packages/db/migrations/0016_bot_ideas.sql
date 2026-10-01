CREATE TABLE "bot_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"site_name" text,
	"image_key" text,
	"category" text,
	"added_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "suggested_by" uuid;--> statement-breakpoint
ALTER TABLE "bot_ideas" ADD CONSTRAINT "bot_ideas_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_ideas" ADD CONSTRAINT "bot_ideas_added_entry_id_entries_id_fk" FOREIGN KEY ("added_entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_ideas_entry_idx" ON "bot_ideas" USING btree ("entry_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_suggested_by_entries_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- An idea added to the pile, or new ideas, touch the bot's card so the feed pulls it (P-06, P-20).
CREATE FUNCTION kasa_bot_idea_touch() RETURNS trigger AS $$
BEGIN
  UPDATE entries SET updated_at = now() WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bot_ideas_touch_entry AFTER INSERT OR UPDATE OR DELETE ON bot_ideas
  FOR EACH ROW EXECUTE FUNCTION kasa_bot_idea_touch();
