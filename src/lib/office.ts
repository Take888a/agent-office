import { query, type Query } from "@anthropic-ai/claude-agent-sdk";

export type EmployeeStatus = "working" | "done" | "error";

export interface EmployeeInfo {
  id: string;
  name: string;
  task: string;
  status: EmployeeStatus;
  emoji: string;
  activity: string;
  detail: string;
  report: string;
  hiredAt: number;
  finishedAt: number | null;
  costUsd: number | null;
}

const NAMES = [
  "ユキ",
  "タロウ",
  "ハナ",
  "ケン",
  "ミオ",
  "ソラ",
  "リン",
  "ダイチ",
  "アオイ",
  "レン",
];

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
  Task: { emoji: "🗣️", label: "部下に指示中" },
  Agent: { emoji: "🗣️", label: "部下に指示中" },
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

interface Employee {
  info: EmployeeInfo;
  handle: Query | null;
}

interface OfficeState {
  employees: Map<string, Employee>;
  seq: number;
  listeners: Set<() => void>;
}

// next dev の HMR でモジュールが再評価されても社員が消えないよう globalThis に保持
const g = globalThis as unknown as { __officeState?: OfficeState };
const state: OfficeState = (g.__officeState ??= {
  employees: new Map(),
  seq: 0,
  listeners: new Set(),
});

function notify() {
  for (const listener of state.listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function listEmployees(): EmployeeInfo[] {
  return [...state.employees.values()]
    .map((e) => e.info)
    .sort((a, b) => a.hiredAt - b.hiredAt);
}

export function hire(task: string): EmployeeInfo {
  const id = `emp-${++state.seq}-${Date.now().toString(36)}`;
  const info: EmployeeInfo = {
    id,
    name: NAMES[(state.seq - 1) % NAMES.length],
    task,
    status: "working",
    emoji: "🚶",
    activity: "出勤中",
    detail: "",
    report: "",
    hiredAt: Date.now(),
    finishedAt: null,
    costUsd: null,
  };
  const employee: Employee = { info, handle: null };
  state.employees.set(id, employee);
  void run(employee, task);
  notify();
  return info;
}

async function run(employee: Employee, task: string) {
  const { info } = employee;
  try {
    const q = query({
      prompt: task,
      options: {
        cwd: process.cwd(),
        permissionMode: "bypassPermissions",
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["project"],
      },
    });
    employee.handle = q;

    for await (const message of q) {
      if (message.type === "assistant") {
        const blocks = message.message?.content ?? [];
        const tool = [...blocks].reverse().find((b) => b.type === "tool_use");
        if (tool && tool.type === "tool_use") {
          const known = toolLabel(tool.name);
          info.emoji = known.emoji;
          info.activity = known.label;
          info.detail = toolDetail(tool.input as Record<string, unknown>);
        } else {
          info.emoji = "✍️";
          info.activity = "報告をまとめ中";
          info.detail = "";
        }
        notify();
      } else if (message.type === "result") {
        info.finishedAt = Date.now();
        info.costUsd =
          "total_cost_usd" in message ? (message.total_cost_usd ?? null) : null;
        if (message.subtype === "success") {
          info.status = "done";
          info.emoji = "✅";
          info.activity = "タスク完了";
          info.report = message.result ?? "";
        } else {
          info.status = "error";
          info.emoji = "⚠️";
          info.activity = `中断 (${message.subtype})`;
          info.report = `エージェントが異常終了しました: ${message.subtype}`;
        }
        info.detail = "";
        notify();
      }
    }
  } catch (err) {
    info.status = "error";
    info.emoji = "⚠️";
    info.activity = "エラー";
    info.detail = "";
    info.report = err instanceof Error ? err.message : String(err);
    info.finishedAt = Date.now();
    notify();
  }
}

/** 作業中なら中断、完了/エラー済みなら退勤(削除) */
export async function fire(id: string): Promise<boolean> {
  const employee = state.employees.get(id);
  if (!employee) return false;
  if (employee.info.status === "working") {
    try {
      await employee.handle?.interrupt();
    } catch {
      // すでに終了していれば無視
    }
    employee.info.status = "error";
    employee.info.emoji = "🛑";
    employee.info.activity = "作業中断";
    employee.info.finishedAt = Date.now();
  } else {
    state.employees.delete(id);
  }
  notify();
  return true;
}
