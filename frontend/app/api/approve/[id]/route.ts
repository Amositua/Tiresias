const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const res = await fetch(`${BACKEND}/approvals/${params.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
