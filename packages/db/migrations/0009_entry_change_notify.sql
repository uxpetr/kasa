-- Realtime (P-06): every change to an entry, its reactions, or its comments bumps
-- entries.updated_at and sends NOTIFY kasa_changes with only the project and entry ids.
-- Clients then fetch the changes through the web API, which checks membership.
CREATE FUNCTION kasa_entry_touch() RETURNS trigger AS $$
BEGIN
  -- An update that sets updated_at itself keeps it (tests, back-fills).
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entries_touch BEFORE UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION kasa_entry_touch();
--> statement-breakpoint
CREATE FUNCTION kasa_entry_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('kasa_changes', json_build_object('projectId', NEW.project_id, 'entryId', NEW.id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entries_notify AFTER INSERT OR UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION kasa_entry_notify();
--> statement-breakpoint
-- Reactions and comments touch their entry, which then notifies.
CREATE FUNCTION kasa_child_touch_entry() RETURNS trigger AS $$
BEGIN
  UPDATE entries SET updated_at = now() WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reactions_touch_entry AFTER INSERT OR UPDATE OR DELETE ON reactions
  FOR EACH ROW EXECUTE FUNCTION kasa_child_touch_entry();
--> statement-breakpoint
CREATE TRIGGER comments_touch_entry AFTER INSERT OR UPDATE OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION kasa_child_touch_entry();
