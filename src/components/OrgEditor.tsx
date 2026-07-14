"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MemberStatus, ProposalInfo } from "@/lib/office";
import type { OrgView } from "@/lib/org";

interface OrgResponse {
  org: OrgView;
  statuses: Record<string, MemberStatus>;
  hrBusy: boolean;
  proposal: ProposalInfo | null;
}

function TeamTree({
  teams,
}: {
  teams: { id: string; name: string; color: string; members: { agent: string; displayName: string; role: string }[] }[];
}) {
  return (
    <div className="space-y-2">
      {teams.map((team) => (
        <div
          key={team.id}
          className="rounded border border-white/10 bg-white/5 p-2"
        >
          <div className="mb-1 flex items-center gap-2 text-amber-50">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: team.color }}
            />
            <span className="font-bold">{team.name}</span>
            <span className="text-xs text-amber-100/50">
              {team.members.length}名
            </span>
          </div>
          <ul className="space-y-0.5 pl-5 text-xs text-amber-100/80">
            {team.members.map((m) => (
              <li key={m.agent}>
                {m.displayName} — {m.role}{" "}
                <code className="text-amber-100/40">({m.agent})</code>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function OrgEditor() {
  const [data, setData] = useState<OrgResponse | null>(null);
  const [request, setRequest] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);

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
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const submitHr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request.trim() || sending || data?.hrBusy) return;
    setSending(true);
    try {
      await fetch("/api/org/hr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: request }),
      });
      setRequest("");
    } finally {
      setSending(false);
    }
  };

  const decide = async (action: "approve" | "reject") => {
    setApplying(true);
    try {
      await fetch("/api/org/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } finally {
      setApplying(false);
    }
  };

  const hrName = data?.org.hr.displayName ?? "人事";
  const hrStatus = data?.statuses[data.org.hr.agent];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 text-sm">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/" className="text-amber-100/60 hover:text-amber-100">
          ← オフィスへ戻る
        </Link>
        <h1 className="text-lg font-bold tracking-widest text-amber-100">
          組織編成
        </h1>
        <Link
          href="/employees"
          className="ml-auto rounded border border-amber-100/30 px-3 py-1.5 text-amber-100/90 hover:bg-white/10"
        >
          社員一覧へ
        </Link>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-xs tracking-widest text-amber-100/60">
          人事({hrName})にオーダー
        </h2>
        <form onSubmit={submitHr} className="flex flex-col gap-2">
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={3}
            placeholder={
              "例: ECサイトの開発案件が始まる。フロント重視の体制にしたい / 案件A・案件Bの2案件を並行するのでチームを案件ごとに分けて"
            }
            className="rounded border border-amber-100/30 bg-white/5 px-3 py-2 text-amber-50 placeholder:text-amber-100/40 focus:border-amber-100/60 focus:outline-none"
            disabled={data?.hrBusy}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={sending || !request.trim() || data?.hrBusy}
              className="rounded bg-amber-200 px-4 py-1.5 font-bold text-[#1a1622] disabled:opacity-40"
            >
              編成を相談する
            </button>
            {data?.hrBusy && (
              <span className="text-xs text-sky-300">
                🗂️ {hrName}が編成案を検討中…{" "}
                {hrStatus?.state === "working"
                  ? `(${hrStatus.emoji} ${hrStatus.detail || hrStatus.activity})`
                  : ""}
              </span>
            )}
          </div>
        </form>
      </section>

      {data?.proposal && (
        <section className="mb-6 rounded border border-amber-200/40 bg-amber-200/5 p-3">
          <h2 className="mb-2 text-xs tracking-widest text-amber-200">
            📋 {hrName}からの編成提案(承認待ち)
          </h2>
          <p className="mb-3 whitespace-pre-wrap text-amber-50">
            {data.proposal.summary}
          </p>
          <TeamTree teams={data.proposal.org.teams} />
          <details className="mt-2 text-xs text-amber-100/60">
            <summary className="cursor-pointer">社員定義の詳細</summary>
            <div className="mt-2 space-y-2">
              {data.proposal.agents.map((a) => (
                <div key={a.name} className="rounded bg-black/40 p-2">
                  <div className="font-bold text-amber-100/90">
                    {a.name} — {a.description}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-amber-100/60">
                    {a.prompt}
                  </pre>
                </div>
              ))}
            </div>
          </details>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide("approve")}
              disabled={applying}
              className="rounded bg-emerald-300 px-4 py-1.5 font-bold text-[#1a1622] disabled:opacity-40"
            >
              承認して適用
            </button>
            <button
              onClick={() => decide("reject")}
              disabled={applying}
              className="rounded border border-rose-300/60 px-4 py-1.5 text-rose-200 disabled:opacity-40"
            >
              却下
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs tracking-widest text-amber-100/60">
          現在の組織
        </h2>
        {!data ? (
          <p className="text-amber-100/50">読み込み中…</p>
        ) : (
          <>
            <div className="mb-2 rounded border border-white/10 bg-white/5 p-2 text-amber-50">
              👔 管理職: {data.org.orchestrator.displayName}{" "}
              <code className="text-xs text-amber-100/40">
                ({data.org.orchestrator.agent})
              </code>
              <span className="mx-3 text-amber-100/30">|</span>
              🗂️ 人事: {data.org.hr.displayName}{" "}
              <code className="text-xs text-amber-100/40">
                ({data.org.hr.agent})
              </code>
            </div>
            <TeamTree teams={data.org.teams} />
            <p className="mt-3 text-xs text-amber-100/40">
              組織は <code>office/org.json</code> と{" "}
              <code>.claude/agents/*.md</code> に保存されます。直接編集しても
              反映されます(社員の実体は Claude Code のサブエージェント定義)。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
