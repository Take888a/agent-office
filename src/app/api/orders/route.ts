import { submitOrder } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: unknown; target?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  const target = typeof body.target === "string" ? body.target : undefined;
  try {
    const order = await submitOrder(body.text.trim(), target);
    return Response.json(order, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
