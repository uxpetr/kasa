// Who listens to which project. Pure, so it can be tested without sockets.
export interface Client {
  send(data: string): void;
}

export class Hub<C extends Client = Client> {
  private readonly byProject = new Map<string, Set<C>>();
  private readonly userOf = new Map<C, string>();
  /** Connected but membership not confirmed yet; they must not receive `changed`. */
  private readonly pending = new Set<C>();

  add(projectId: string, client: C, userId?: string, pending = false) {
    const set = this.byProject.get(projectId) ?? new Set<C>();
    set.add(client);
    this.byProject.set(projectId, set);
    if (userId) this.userOf.set(client, userId);
    if (pending) this.pending.add(client);
  }

  /** Membership confirmed; this client may receive `changed`. */
  confirm(client: C) {
    this.pending.delete(client);
  }

  remove(projectId: string, client: C) {
    this.userOf.delete(client);
    this.pending.delete(client);
    const set = this.byProject.get(projectId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.byProject.delete(projectId);
  }

  /** Takes out a user's clients for one project, e.g. after they left or were removed (P-15). */
  takeUser(projectId: string, userId: string): C[] {
    const taken = [...(this.byProject.get(projectId) ?? [])].filter((c) => this.userOf.get(c) === userId);
    for (const client of taken) this.remove(projectId, client);
    return taken;
  }

  /** Tells every confirmed client of one project that something changed. Only ids travel; content comes from the web API. */
  notify(projectId: string) {
    const message = JSON.stringify({ type: "changed", projectId });
    for (const client of this.byProject.get(projectId) ?? []) {
      if (this.pending.has(client)) continue;
      client.send(message);
    }
  }

  /** After a lost database connection nobody knows what was missed, so everyone catches up. */
  notifyAll() {
    for (const projectId of this.byProject.keys()) this.notify(projectId);
  }

  /** Distinct (project, user) pairs currently connected, for membership reconciliation after LISTEN reconnects. */
  members(): { projectId: string; userId: string }[] {
    const seen = new Set<string>();
    const out: { projectId: string; userId: string }[] = [];
    for (const [projectId, set] of this.byProject) {
      for (const client of set) {
        const userId = this.userOf.get(client);
        if (!userId) continue;
        const key = `${projectId}:${userId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ projectId, userId });
      }
    }
    return out;
  }

  get size() {
    let n = 0;
    for (const set of this.byProject.values()) n += set.size;
    return n;
  }
}
