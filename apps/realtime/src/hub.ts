// Who listens to which project. Pure, so it can be tested without sockets.
export interface Client {
  send(data: string): void;
}

export class Hub<C extends Client = Client> {
  private readonly byProject = new Map<string, Set<C>>();
  private readonly userOf = new Map<C, string>();

  add(projectId: string, client: C, userId?: string) {
    const set = this.byProject.get(projectId) ?? new Set<C>();
    set.add(client);
    this.byProject.set(projectId, set);
    if (userId) this.userOf.set(client, userId);
  }

  remove(projectId: string, client: C) {
    this.userOf.delete(client);
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

  /** Tells every client of one project that something changed. Only ids travel; content comes from the web API. */
  notify(projectId: string) {
    const message = JSON.stringify({ type: "changed", projectId });
    for (const client of this.byProject.get(projectId) ?? []) client.send(message);
  }

  /** After a lost database connection nobody knows what was missed, so everyone catches up. */
  notifyAll() {
    for (const projectId of this.byProject.keys()) this.notify(projectId);
  }

  get size() {
    let n = 0;
    for (const set of this.byProject.values()) n += set.size;
    return n;
  }
}
