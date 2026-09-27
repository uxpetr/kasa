// Who listens to which project. Pure, so it can be tested without sockets.
export interface Client {
  send(data: string): void;
}

export class Hub<C extends Client = Client> {
  private readonly byProject = new Map<string, Set<C>>();

  add(projectId: string, client: C) {
    const set = this.byProject.get(projectId) ?? new Set<C>();
    set.add(client);
    this.byProject.set(projectId, set);
  }

  remove(projectId: string, client: C) {
    const set = this.byProject.get(projectId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.byProject.delete(projectId);
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
