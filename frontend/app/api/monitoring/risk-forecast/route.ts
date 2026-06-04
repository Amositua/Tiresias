import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") ?? "";
  const url = `http://localhost:8000/monitoring/risk-forecast${refresh ? "?refresh=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data);
}
