import { NextRequest, NextResponse } from "next/server";

import { ACTION_ROUTE_PREFIXES, EMERGENCY_STOP_COOKIE } from "@/lib/emergency-stop";

const EXEMPT_API_ROUTES = new Set(["/api/health", "/api/emergency-stop"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  if (EXEMPT_API_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  const stopped = request.cookies.get(EMERGENCY_STOP_COOKIE)?.value === "true";
  const isActionRoute = ACTION_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (stopped && isActionRoute) {
    return NextResponse.json(
      { error: "Emergency stop is engaged. Action routes are blocked." },
      { status: 423 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
