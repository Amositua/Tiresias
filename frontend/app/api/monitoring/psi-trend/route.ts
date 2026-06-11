import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET() {
  const res = await fetch(`${BACKEND}/monitoring/psi-trend`, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data);
}
