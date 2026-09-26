import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const run = (headers: Record<string, string> = {}) => proxy(new NextRequest("http://localhost/api/uploads", { headers }));
// NextResponse.next forwards overridden request headers under this prefix.
const forwarded = (res: Response) => res.headers.get("x-middleware-request-x-request-id");

describe("proxy request id", () => {
  it("creates an id and passes it to the route and the response", () => {
    const res = run();
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(forwarded(res)).toBe(id);
  });

  it("keeps a sane incoming id", () => {
    const res = run({ "x-request-id": "trace-abc_123.4" });
    expect(res.headers.get("x-request-id")).toBe("trace-abc_123.4");
  });

  it("replaces ids that are too short, too long, or carry odd characters", () => {
    for (const bad of ["short", "a".repeat(129), "abc def ghi", "abc;defgh", "<script>x</script>"]) {
      expect(run({ "x-request-id": bad }).headers.get("x-request-id")).not.toBe(bad);
    }
  });
});
