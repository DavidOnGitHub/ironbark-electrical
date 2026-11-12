import type { NextFetchEvent, NextRequest } from "next/server";
import kitProxy from "@kabosh-digital/m-street-kit/proxy";

// The session gate itself lives in the kit (see its proxy doc). Next checks
// this file statically for a function export and for `config`, so both are
// declared here rather than re-exported.
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return kitProxy(request, event);
}

export const config = {
  matcher: ["/((?!api/auth|api/assistant|api/health|api/stripe|api/it/scan|pay|accept/|book/|auth|privacy|google-limited-use|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
