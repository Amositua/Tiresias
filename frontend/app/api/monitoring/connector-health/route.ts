import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch("http://localhost:8000/monitoring/connector-health", { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data);
}
