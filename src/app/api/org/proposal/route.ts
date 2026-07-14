import { approveProposal, rejectProposal } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "approve") {
      await approveProposal();
    } else if (body.action === "reject") {
      rejectProposal();
    } else {
      return Response.json({ error: "action must be approve|reject" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
