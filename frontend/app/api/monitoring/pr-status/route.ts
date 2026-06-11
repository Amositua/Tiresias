import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get("report_id");
  if (!reportId) return NextResponse.json({ error: "missing report_id" }, { status: 400 });
  const res = await fetch(`${BACKEND}/monitoring/pr-status/${reportId}`, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data);
}
