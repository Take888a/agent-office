import { getUsageStats } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getUsageStats());
}
