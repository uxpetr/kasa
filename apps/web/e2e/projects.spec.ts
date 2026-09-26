import { expect, test, type APIRequestContext } from "@playwright/test";
import { createUsers } from "./support/users";

// Drives the real API with bearer sessions (D-128) created straight in the database.
test.describe("projects and invites API", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Awaited<ReturnType<typeof createUsers<"owner" | "joiner" | "outsider">>>;

  test.beforeAll(async () => {
    setup = await createUsers(["owner", "joiner", "outsider"]);
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const as = (request: APIRequestContext, who: "owner" | "joiner" | "outsider") => {
    const headers = setup.users[who].headers;
    return {
      get: (url: string) => request.get(url, { headers }),
      post: (url: string, data?: unknown) => request.post(url, { headers, data }),
      patch: (url: string, data: unknown) => request.patch(url, { headers, data }),
      delete: (url: string) => request.delete(url, { headers }),
    };
  };

  test("create, invite by link, join as editor, archive", async ({ request }) => {
    const owner = as(request, "owner");
    const joiner = as(request, "joiner");
    const outsider = as(request, "outsider");

    const created = await owner.post("/api/projects", { name: "Japan 2027" });
    expect(created.status()).toBe(201);
    const project = await created.json();
    expect(project).toMatchObject({ name: "Japan 2027", role: "owner", memberCount: 1 });

    expect((await outsider.patch(`/api/projects/${project.id}`, { name: "x" })).status()).toBe(404);
    expect((await outsider.post(`/api/projects/${project.id}/invites`)).status()).toBe(404);

    const invite = await owner.post(`/api/projects/${project.id}/invites`);
    expect(invite.status()).toBe(201);
    const { token, url } = await invite.json();
    expect(url).toBe(`http://localhost:3100/invite/${token}`);

    const preview = await joiner.get(`/api/invites/${token}`);
    expect(await preview.json()).toMatchObject({ projectName: "Japan 2027", alreadyMember: false });
    const accepted = await joiner.post(`/api/invites/${token}/accept`);
    expect(await accepted.json()).toEqual({ projectId: project.id, role: "editor" });

    // Editors rename but don't invite or archive (D-139, D-140).
    expect((await joiner.patch(`/api/projects/${project.id}`, { name: "Japan 2028" })).status()).toBe(200);
    expect((await joiner.post(`/api/projects/${project.id}/invites`)).status()).toBe(403);
    expect((await joiner.patch(`/api/projects/${project.id}`, { archived: true })).status()).toBe(403);

    const listed = await (await joiner.get("/api/projects")).json();
    expect(listed.projects).toContainEqual(expect.objectContaining({ id: project.id, name: "Japan 2028", role: "editor", memberCount: 2 }));

    expect((await owner.patch(`/api/projects/${project.id}`, { archived: true })).status()).toBe(200);
    expect((await joiner.patch(`/api/projects/${project.id}`, { name: "x" })).status()).toBe(403);
    expect((await outsider.post(`/api/invites/${token}/accept`)).status()).toBe(410);

    expect((await owner.delete(`/api/projects/${project.id}/invites`)).status()).toBe(200);
  });
});
