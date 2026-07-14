import { getOfficeState } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getOfficeState();
  return Response.json({
    org: s.org,
    statuses: s.statuses,
    hrBusy: s.hrBusy,
    proposal: s.proposal,
  });
}
