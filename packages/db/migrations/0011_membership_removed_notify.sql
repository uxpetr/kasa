-- Members (P-15): when someone leaves or is removed, tell the realtime service so it closes
-- their sockets for that project. Tickets are only checked on connect (D-157).
CREATE FUNCTION kasa_membership_removed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('kasa_changes', json_build_object('projectId', OLD.project_id, 'removedUserId', OLD.user_id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER memberships_removed AFTER DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION kasa_membership_removed();
