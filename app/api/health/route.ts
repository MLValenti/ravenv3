import { NextResponse } from "next/server.js";

import pkg from "@/package.json";

export function GET() {
  return NextResponse.json({
    name: "Raven",
    version: pkg.version,
    uptimeSeconds: Math.floor(process.uptime()),
  });
}
