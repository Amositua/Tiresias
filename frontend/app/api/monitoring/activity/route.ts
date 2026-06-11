import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET() {
  const res = await fetch(`${BACKEND}/monitoring/activity?limit=50`, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data);
}
