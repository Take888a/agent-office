import { hire, listEmployees } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(listEmployees());
}

export async function POST(req: Request) {
  let task: unknown;
  try {
    ({ task } = await req.json());
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof task !== "string" || !task.trim()) {
    return Response.json({ error: "task is required" }, { status: 400 });
  }
  const employee = hire(task.trim());
  return Response.json(employee, { status: 201 });
}
