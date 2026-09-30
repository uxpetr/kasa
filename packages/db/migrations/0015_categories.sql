ALTER TABLE "categories" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "sorted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entry_categories" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_categories" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_categories" ADD CONSTRAINT "entry_categories_receipt_id_entries_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_categories_receipt_idx" ON "entry_categories" USING btree ("receipt_id");--> statement-breakpoint
-- Entries already in a category (the demo seed) count as sorted, so Kasa Bot leaves them alone.
UPDATE "entries" SET "sorted_at" = now() WHERE "id" IN (SELECT "entry_id" FROM "entry_categories");
--> statement-breakpoint
-- Live updates (P-06, P-19): a category added to or taken off an entry touches the entry and the
-- sorting receipt that lists it, which then notify.
CREATE FUNCTION kasa_entry_category_touch() RETURNS trigger AS $$
BEGIN
  UPDATE entries SET updated_at = now()
    WHERE id IN (COALESCE(NEW.entry_id, OLD.entry_id), NEW.receipt_id, OLD.receipt_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entry_categories_touch_entry AFTER INSERT OR UPDATE OR DELETE ON entry_categories
  FOR EACH ROW EXECUTE FUNCTION kasa_entry_category_touch();
--> statement-breakpoint
-- A renamed category touches its entries and receipts, and tells the pile even when it's empty,
-- so everyone's chips update. (Removing one deletes its entry_categories rows, which touch them.)
CREATE FUNCTION kasa_category_touch() RETURNS trigger AS $$
DECLARE
  project uuid := COALESCE(NEW.project_id, OLD.project_id);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    UPDATE entries SET updated_at = now()
      WHERE id IN (SELECT entry_id FROM entry_categories WHERE category_id = NEW.id
                   UNION SELECT receipt_id FROM entry_categories WHERE category_id = NEW.id);
  END IF;
  PERFORM pg_notify('kasa_changes', json_build_object('projectId', project)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER categories_notify AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION kasa_category_touch();
