import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import {
  loadOrgView,
  applyOrg,
  validateProposal,
  allMembers,
  type OrgView,
  type AgentDef,
  type OrgConfig,
} from "@/lib/org";

// ---- 公開する状態の型 ----

export type MemberState = "idle" | "working";

export interface MemberStatus {
  state: MemberState;
  emoji: string;
  activity: string;
  detail: string;
  orderId: string | null;
}

export type OrderStatus = "working" | "done" | "error";

export interface OrderInfo {
  id: string;
  text: string;
  /** 委譲先: "orchestrator" または社員の agent 名(直接指名) */
  target: string;
  targetName: string;
  status: OrderStatus;
  report: string;
  createdAt: number;
  finishedAt: number | null;
  costUsd: number | null;
}

export interface ProposalInfo {
  summary: string;
  org: OrgConfig;
  agents: AgentDef[];
}

export interface OfficeState {
  org: OrgView;
  statuses: Record<string, MemberStatus>;
  orders: OrderInfo[];
  hrBusy: boolean;
  proposal: ProposalInfo | null;
}

// ---- 内部状態 ----

interface OrderRuntime {
  info: OrderInfo;
  handle: Query | null;
}

interface InternalState {
  orders: Map<string, OrderRuntime>;
  statuses: Map<string, MemberStatus>;
  seq: number;
  hrBusy: boolean;
  hrHandle: Query | null;
  proposal: ProposalInfo | null;
  listeners: Set<() => void>;
}

// next dev の HMR でモジュールが再評価されても状態が消えないよう globalThis に保持
const g = globalThis as unknown as { __officeStateV2?: InternalState };
const state: InternalState = (g.__officeStateV2 ??= {
  orders: new Map(),
  statuses: new Map(),
  seq: 0,
  hrBusy: false,
  hrHandle: null,
  proposal: null,
  listeners: new Set(),
});

function notify() {
  for (const listener of state.listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export async function getOfficeState(): Promise<OfficeState> {
  // org.json / .claude/agents は手で編集しても反映されるよう毎回読む(小さいファイル群)
  const org = await loadOrgView();
  const statuses: Record<string, MemberStatus> = {};
  for (const m of allMembers(org)) {
    statuses[m.agent] = state.statuses.get(m.agent) ?? {
      state: "idle",
      emoji: "",
      activity: "休憩中",
      detail: "",
      orderId: null,
    };
  }
  return {
    org,
    statuses,
    orders: [...state.orders.values()]
      .map((o) => o.info)
      .sort((a, b) => b.createdAt - a.createdAt),
    hrBusy: state.hrBusy,
    proposal: state.proposal,
  };
}

export function notifyOrgChanged() {
  notify();
}

// ---- 活動ラベル ----

const TOOL_LABELS: Record<string, { emoji: string; label: string }> = {
  Bash: { emoji: "⚡", label: "コマンド実行中" },
  Edit: { emoji: "💻", label: "コーディング中" },
  Write: { emoji: "💻", label: "コーディング中" },
  MultiEdit: { emoji: "💻", label: "コーディング中" },
  NotebookEdit: { emoji: "💻", label: "コーディング中" },
  Read: { emoji: "📖", label: "コード読み中" },
  Grep: { emoji: "🔍", label: "コード検索中" },
  Glob: { emoji: "🔍", label: "コード検索中" },
  WebSearch: { emoji: "🌐", label: "Web調査中" },
  WebFetch: { emoji: "🌐", label: "Web調査中" },
  Task: { emoji: "🗣️", label: "指示出し中" },
  TodoWrite: { emoji: "📝", label: "タスク整理中" },
};

function toolLabel(name: string): { emoji: string; label: string } {
  const known = TOOL_LABELS[name];
  if (known) return known;
  if (name.startsWith("mcp__")) {
    const action = name.split("__").pop() ?? name;
    return { emoji: "🔌", label: `${action} 実行中` };
  }
  return { emoji: "🔧", label: `${name || "ツール"}を実行中` };
}

function toolDetail(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  if (typeof input.description === "string") return input.description;
  if (typeof input.file_path === "string")
    return input.file_path.split("/").pop() ?? "";
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.query === "string") return input.query;
  if (typeof input.command === "string") return input.command;
  if (typeof input.prompt === "string") return input.prompt.slice(0, 60);
  return "";
}

function setStatus(agent: string, status: Partial<MemberStatus> & { state: MemberState }) {
  const prev = state.statuses.get(agent);
  state.statuses.set(agent, {
    emoji: "",
    activity: status.state === "idle" ? "休憩中" : "作業中",
    detail: "",
    orderId: prev?.orderId ?? null,
    ...status,
  });
  notify();
}

// ---- オーダー実行 ----

/** SDK メッセージから content blocks を安全に取り出す */
function contentBlocks(message: unknown): Array<Record<string, unknown>> {
  const m = message as { message?: { content?: unknown } };
  return Array.isArray(m.message?.content)
    ? (m.message.content as Array<Record<string, unknown>>)
    : [];
}

async function buildOrchestratorPrompt(org: OrgView, orderText: string): Promise<string> {
  const roster = org.teams
    .map(
      (t) =>
        `### ${t.name}\n` +
        t.members
          .map(
            (m) =>
              `- ${m.displayName} (subagent_type: \`${m.agent}\`) — ${m.role}。${org.agents[m.agent]?.description ?? ""}`,
          )
          .join("\n"),
    )
    .join("\n\n");
  const persona = org.agents[org.orchestrator.agent]?.prompt ?? "";
  return [
    persona,
    "",
    "## あなたのチーム(Task ツールの subagent_type に指定して委譲する)",
    roster,
    "",
    "## オーナーからの指示",
    orderText,
  ].join("\n");
}

export async function submitOrder(text: string, target?: string): Promise<OrderInfo> {
  const org = await loadOrgView();
  const isDirect = !!target && target !== "orchestrator";
  const targetAgent = isDirect ? target : org.orchestrator.agent;
  const member = allMembers(org).find((m) => m.agent === targetAgent);
  if (!member) throw new Error(`unknown agent: ${targetAgent}`);

  const id = `order-${++state.seq}-${Date.now().toString(36)}`;
  const info: OrderInfo = {
    id,
    text,
    target: isDirect ? targetAgent : "orchestrator",
    targetName: member.displayName,
    status: "working",
    report: "",
    createdAt: Date.now(),
    finishedAt: null,
    costUsd: null,
  };
  const runtime: OrderRuntime = { info, handle: null };
  state.orders.set(id, runtime);
  void runOrder(runtime, org, targetAgent, isDirect);
  notify();
  return info;
}

async function runOrder(
  runtime: OrderRuntime,
  org: OrgView,
  rootAgent: string,
  isDirect: boolean,
) {
  const { info } = runtime;
  // Task tool_use id -> 委譲先社員の agent 名
  const delegation = new Map<string, string>();
  // このオーダーで働いた社員(終了時にまとめて待機へ戻す)
  const touched = new Set<string>([rootAgent]);

  const applyActivity = (agent: string, blocks: Array<Record<string, unknown>>) => {
    const tool = [...blocks]
      .reverse()
      .find((b) => b.type === "tool_use") as
      | { name?: string; id?: string; input?: Record<string, unknown> }
      | undefined;
    if (tool?.name) {
      // Task 委譲: 委譲先社員を作業中にする
      if (tool.name === "Task" && typeof tool.input?.subagent_type === "string") {
        const sub = tool.input.subagent_type;
        if (typeof tool.id === "string") delegation.set(tool.id, sub);
        touched.add(sub);
        setStatus(sub, {
          state: "working",
          emoji: "📥",
          activity: "指示を受けた",
          detail:
            typeof tool.input.description === "string" ? tool.input.description : "",
          orderId: info.id,
        });
      }
      const known = toolLabel(tool.name);
      setStatus(agent, {
        state: "working",
        emoji: known.emoji,
        activity: known.label,
        detail: toolDetail(tool.input),
        orderId: info.id,
      });
    } else {
      setStatus(agent, {
        state: "working",
        emoji: "✍️",
        activity: "考えをまとめ中",
        detail: "",
        orderId: info.id,
      });
    }
  };

  try {
    const prompt = isDirect
      ? [
          org.agents[rootAgent]?.prompt ?? "",
          "",
          "## オーナーからの指示(あなたへの直接指名)",
          info.text,
        ].join("\n")
      : await buildOrchestratorPrompt(org, info.text);

    const q = query({
      prompt,
      options: {
        cwd: process.cwd(),
        permissionMode: "bypassPermissions",
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["project"], // .claude/agents のサブエージェントを読み込む
      },
    });
    runtime.handle = q;
    setStatus(rootAgent, {
      state: "working",
      emoji: "🧠",
      activity: isDirect ? "指示を確認中" : "作業を計画中",
      detail: "",
      orderId: info.id,
    });

    for await (const message of q) {
      const parentId = (message as { parent_tool_use_id?: string | null })
        .parent_tool_use_id;

      if (message.type === "assistant") {
        const agent = parentId ? delegation.get(parentId) : rootAgent;
        if (agent) applyActivity(agent, contentBlocks(message));
      } else if (message.type === "user" && !parentId) {
        // 管理職に返ってきた tool_result: Task 完了なら委譲先を待機へ
        for (const block of contentBlocks(message)) {
          if (
            block.type === "tool_result" &&
            typeof block.tool_use_id === "string"
          ) {
            const sub = delegation.get(block.tool_use_id);
            if (sub) {
              setStatus(sub, { state: "idle", activity: "報告済み・休憩中", orderId: null });
            }
          }
        }
      } else if (message.type === "result") {
        info.finishedAt = Date.now();
        info.costUsd =
          "total_cost_usd" in message ? (message.total_cost_usd ?? null) : null;
        if (message.subtype === "success") {
          info.status = "done";
          info.report = message.result ?? "";
        } else {
          info.status = "error";
          info.report = `エージェントが異常終了しました: ${message.subtype}`;
        }
      }
    }
  } catch (err) {
    info.status = "error";
    info.report = err instanceof Error ? err.message : String(err);
    info.finishedAt = Date.now();
  } finally {
    for (const agent of touched) {
      const s = state.statuses.get(agent);
      if (s?.orderId === info.id) {
        setStatus(agent, { state: "idle", orderId: null });
      }
    }
    notify();
  }
}

/** 進行中なら中断。中断済み/完了済みのオーダーは履歴から削除 */
export async function cancelOrder(id: string): Promise<boolean> {
  const runtime = state.orders.get(id);
  if (!runtime) return false;
  if (runtime.info.status === "working") {
    try {
      await runtime.handle?.interrupt();
    } catch {
      // すでに終了していれば無視
    }
    runtime.info.status = "error";
    runtime.info.report ||= "オーナーにより中断されました";
    runtime.info.finishedAt = Date.now();
  } else {
    state.orders.delete(id);
  }
  notify();
  return true;
}

// ---- 人事(採用・チーム編成) ----

function buildHrPrompt(org: OrgView, request: string): string {
  const currentAgents = allMembers(org)
    .map((m) => {
      const a = org.agents[m.agent];
      return `#### ${m.agent} (${m.displayName} / ${m.role})\ndescription: ${a?.description ?? ""}\nprompt:\n${a?.prompt ?? ""}`;
    })
    .join("\n\n");
  return [
    org.agents[org.hr.agent]?.prompt ?? "",
    "",
    "## 現在の組織 (office/org.json)",
    "```json",
    JSON.stringify(
      { orchestrator: org.orchestrator, hr: org.hr, teams: org.teams },
      null,
      2,
    ),
    "```",
    "",
    "## 現在の社員定義",
    currentAgents,
    "",
    "## オーナーからの要望",
    request,
    "",
    "## あなたのタスク",
    "上記要望に対する最適な組織編成を提案してください。**ファイルは一切変更しないこと。**",
    "提案は必ず以下のスキーマの JSON を ```json フェンスで1つだけ出力してください。",
    "```",
    `{
  "summary": "編成方針の説明(オーナー向け、日本語)",
  "org": { "orchestrator": {"agent","displayName"}, "hr": {"agent","displayName"}, "teams": [{"id","name","color","members":[{"agent","displayName","role"}]}] },
  "agents": [ { "name": "エージェント名(小文字ケバブケース)", "displayName": "...", "description": "管理職が委譲判断に使う説明", "prompt": "社員のシステムプロンプト(Markdown)" } ]
}`,
    "```",
    "agents には org が参照する全社員分の定義を含めてください(続投する社員も含む。改善があれば更新してよい)。",
  ].join("\n");
}

export async function submitHrOrder(request: string): Promise<void> {
  if (state.hrBusy) throw new Error("人事担当は対応中です");
  const org = await loadOrgView();
  const hrAgent = org.hr.agent;
  state.hrBusy = true;
  state.proposal = null;
  notify();

  try {
    const q = query({
      prompt: buildHrPrompt(org, request),
      options: {
        cwd: process.cwd(),
        // 提案の作成に書き込みは不要。調査用に読み取り系のみ許可
        permissionMode: "default",
        allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });
    state.hrHandle = q;
    setStatus(hrAgent, {
      state: "working",
      emoji: "🗂️",
      activity: "編成案を検討中",
      detail: request.slice(0, 40),
      orderId: null,
    });

    for await (const message of q) {
      if (message.type === "assistant") {
        const blocks = contentBlocks(message);
        const tool = [...blocks].reverse().find((b) => b.type === "tool_use") as
          | { name?: string; input?: Record<string, unknown> }
          | undefined;
        if (tool?.name) {
          const known = toolLabel(tool.name);
          setStatus(hrAgent, {
            state: "working",
            emoji: known.emoji,
            activity: known.label,
            detail: toolDetail(tool.input),
            orderId: null,
          });
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          const text = message.result ?? "";
          const jsonText = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text;
          const parsed = validateProposal(JSON.parse(jsonText));
          state.proposal = parsed;
        } else {
          throw new Error(`人事担当が異常終了しました: ${message.subtype}`);
        }
      }
    }
  } finally {
    state.hrBusy = false;
    state.hrHandle = null;
    setStatus(hrAgent, { state: "idle", orderId: null });
    notify();
  }
}

export async function approveProposal(): Promise<void> {
  const proposal = state.proposal;
  if (!proposal) throw new Error("承認待ちの提案がありません");
  await applyOrg(proposal.org, proposal.agents);
  state.proposal = null;
  notifyOrgChanged();
}

export function rejectProposal(): void {
  state.proposal = null;
  notify();
}
