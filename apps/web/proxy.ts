import { NextResponse, type NextRequest } from "next/server";

const REQUEST_ID_HEADER = "x-request-id";
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Gives every request an id (F-07): kept from the caller when it looks sane, otherwise new.
 * It's passed on to route handlers and returned in the response for support and log lookups.
 */
export function proxy(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|samples/).*)"],
};
