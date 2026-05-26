const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get("table") ?? "deal_pipeline_stage";
  const column = searchParams.get("column") ?? "label";
  const res = await fetch(
    `${BACKEND}/lineage/blast-radius?table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`,
    { cache: "no-store" }
  );
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
