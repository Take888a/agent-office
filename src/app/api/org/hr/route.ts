import { submitHrOrder } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  try {
    // 提案の作成は数分かかりうるため待たずに返す。進捗は SSE で届く
    void submitHrOrder(body.text.trim()).catch(() => {});
    return Response.json({ ok: true }, { status: 202 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
