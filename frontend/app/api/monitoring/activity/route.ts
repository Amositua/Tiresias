import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch("http://localhost:8000/monitoring/activity?limit=50", { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data);
}
