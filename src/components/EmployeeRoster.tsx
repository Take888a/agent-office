"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MemberStatus } from "@/lib/office";
import type { OrgView } from "@/lib/org";

interface OrgResponse {
  org: OrgView;
  statuses: Record<string, MemberStatus>;
}

function StatusBadge({ status }: { status: MemberStatus | undefined }) {
  if (status?.state === "working") {
    return (
      <span className="rounded bg-sky-900/60 px-1.5 py-0.5 text-xs text-sky-200">
        {status.emoji} {status.detail || status.activity}
      </span>
    );
  }
  return (
    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-amber-100/50">
      待機中
    </span>
  );
}

function MemberCard({
  agent,
  displayName,
  role,
  description,
  status,
}: {
  agent: string;
  displayName: string;
  role: string;
  description: string;
  status: MemberStatus | undefined;
}) {
  return (
    <div className="rounded border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-bold text-amber-50">{displayName}</span>
        <span className="text-xs text-amber-100/60">{role}</span>
        <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-amber-100/40">
          {agent}
        </code>
        <div className="ml-auto">
          <StatusBadge status={status} />
        </div>
      </div>
      {description && (
        <p className="mt-2 text-xs leading-relaxed text-amber-100/70">
          {description}
        </p>
      )}
    </div>
  );
}

export default function EmployeeRoster() {
  const [data, setData] = useState<OrgResponse | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/org");
        if (!stopped && res.ok) setData(await res.json());
      } catch {
        // ignore
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 text-sm">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/" className="text-amber-100/60 hover:text-amber-100">
          ← オフィスへ戻る
        </Link>
        <h1 className="text-lg font-bold tracking-widest text-amber-100">
          社員一覧
        </h1>
        <Link
          href="/org"
          className="ml-auto rounded border border-amber-100/30 px-3 py-1.5 text-amber-100/90 hover:bg-white/10"
        >
          組織編成へ
        </Link>
      </header>

      {!data ? (
        <p className="text-amber-100/50">読み込み中…</p>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-xs tracking-widest text-amber-100/60">
              経営・管理
            </h2>
            <div className="space-y-2">
              <MemberCard
                agent={data.org.orchestrator.agent}
                displayName={data.org.orchestrator.displayName}
                role="管理職(オーケストレータ)"
                description={
                  data.org.agents[data.org.orchestrator.agent]?.description ?? ""
                }
                status={data.statuses[data.org.orchestrator.agent]}
              />
              <MemberCard
                agent={data.org.hr.agent}
                displayName={data.org.hr.displayName}
                role="人事(採用・チーム編成)"
                description={data.org.agents[data.org.hr.agent]?.description ?? ""}
                status={data.statuses[data.org.hr.agent]}
              />
            </div>
          </section>

          {data.org.teams.map((team) => (
            <section key={team.id}>
              <h2 className="mb-2 flex items-center gap-2 text-xs tracking-widest text-amber-100/60">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: team.color }}
                />
                {team.name}({team.members.length}名)
              </h2>
              <div className="space-y-2">
                {team.members.map((m) => (
                  <MemberCard
                    key={m.agent}
                    agent={m.agent}
                    displayName={m.displayName}
                    role={m.role}
                    description={data.org.agents[m.agent]?.description ?? ""}
                    status={data.statuses[m.agent]}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
