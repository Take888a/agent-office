import { loadOrgConfig, allMembers, writeAgentDef } from "@/lib/org";
import { notifyOrgChanged } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ agent: string }> },
) {
  const { agent } = await params;
  let body: { description?: unknown; prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.description !== "string" || typeof body.prompt !== "string") {
    return Response.json(
      { error: "description and prompt are required" },
      { status: 400 },
    );
  }
  // 組織に属する社員の定義のみ編集可
  const org = await loadOrgConfig();
  if (!allMembers(org).some((m) => m.agent === agent)) {
    return Response.json({ error: "unknown agent" }, { status: 404 });
  }
  try {
    await writeAgentDef(agent, body.description.trim(), body.prompt);
    notifyOrgChanged();
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
