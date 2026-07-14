import fs from "node:fs/promises";
import path from "node:path";

/** office/org.json のスキーマ(チーム編成)。社員の実体は .claude/agents/*.md */
export interface OrgMember {
  agent: string; // .claude/agents/<agent>.md のファイル名
  displayName: string;
  role: string;
}

export interface OrgTeam {
  id: string;
  name: string;
  color: string;
  members: OrgMember[];
}

export interface OrgConfig {
  orchestrator: { agent: string; displayName: string };
  hr: { agent: string; displayName: string };
  teams: OrgTeam[];
}

/** 表示用: メンバーにサブエージェント定義の情報を合成したもの */
export interface OrgView extends OrgConfig {
  agents: Record<string, { description: string; prompt: string; exists: boolean }>;
}

const ORG_PATH = path.join(process.cwd(), "office", "org.json");
const AGENTS_DIR = path.join(process.cwd(), ".claude", "agents");

export function agentFilePath(agent: string): string {
  return path.join(AGENTS_DIR, `${agent}.md`);
}

/** サブエージェント .md の frontmatter(description) と本文(プロンプト)を読む */
async function readAgentFile(
  agent: string,
): Promise<{ description: string; prompt: string; exists: boolean }> {
  let raw: string;
  try {
    raw = await fs.readFile(agentFilePath(agent), "utf8");
  } catch {
    return { description: "", prompt: "", exists: false };
  }
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { description: "", prompt: raw.trim(), exists: true };
  const description =
    m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { description, prompt: m[2].trim(), exists: true };
}

export async function loadOrgConfig(): Promise<OrgConfig> {
  const raw = await fs.readFile(ORG_PATH, "utf8");
  return JSON.parse(raw) as OrgConfig;
}

export function allMembers(org: OrgConfig): OrgMember[] {
  return [
    { agent: org.orchestrator.agent, displayName: org.orchestrator.displayName, role: "管理職" },
    { agent: org.hr.agent, displayName: org.hr.displayName, role: "人事" },
    ...org.teams.flatMap((t) => t.members),
  ];
}

export async function loadOrgView(): Promise<OrgView> {
  const org = await loadOrgConfig();
  const agents: OrgView["agents"] = {};
  await Promise.all(
    allMembers(org).map(async (m) => {
      agents[m.agent] = await readAgentFile(m.agent);
    }),
  );
  return { ...org, agents };
}

/** 人事提案の適用に使う: 組織と社員定義を書き込む */
export interface AgentDef {
  name: string;
  description: string;
  prompt: string;
}

/** 社員定義(.claude/agents/<name>.md)を書き込む */
export async function writeAgentDef(
  name: string,
  description: string,
  prompt: string,
): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`invalid agent name: ${name}`);
  }
  await fs.mkdir(AGENTS_DIR, { recursive: true });
  const body = `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n${prompt.trim()}\n`;
  await fs.writeFile(agentFilePath(name), body, "utf8");
}

export async function applyOrg(org: OrgConfig, agents: AgentDef[]): Promise<void> {
  const oldOrg = await loadOrgConfig().catch(() => null);

  for (const a of agents) {
    await writeAgentDef(a.name, a.description, a.prompt);
  }

  await fs.mkdir(path.dirname(ORG_PATH), { recursive: true });
  await fs.writeFile(ORG_PATH, JSON.stringify(org, null, 2) + "\n", "utf8");

  // 旧組織にいて新組織にいない社員の定義ファイルは削除(管理対象のみ・最小限)
  if (oldOrg) {
    const newNames = new Set(allMembers(org).map((m) => m.agent));
    for (const m of allMembers(oldOrg)) {
      if (!newNames.has(m.agent)) {
        await fs.rm(agentFilePath(m.agent), { force: true });
      }
    }
  }
}

/** 提案JSONの最低限の検証 */
export function validateProposal(data: unknown): {
  org: OrgConfig;
  agents: AgentDef[];
  summary: string;
} {
  const p = data as {
    summary?: unknown;
    org?: Partial<OrgConfig>;
    agents?: unknown;
  };
  const org = p.org;
  if (
    !org ||
    typeof org.orchestrator?.agent !== "string" ||
    typeof org.hr?.agent !== "string" ||
    !Array.isArray(org.teams)
  ) {
    throw new Error("提案の org が不正です");
  }
  for (const t of org.teams) {
    if (typeof t.id !== "string" || typeof t.name !== "string" || !Array.isArray(t.members)) {
      throw new Error(`提案のチーム定義が不正です: ${JSON.stringify(t).slice(0, 80)}`);
    }
    t.color ||= "#4f7fc9";
  }
  if (!Array.isArray(p.agents)) throw new Error("提案の agents が不正です");
  const agents = (p.agents as AgentDef[]).map((a) => {
    if (typeof a.name !== "string" || typeof a.prompt !== "string") {
      throw new Error("提案の agent 定義が不正です");
    }
    return { name: a.name, description: a.description ?? "", prompt: a.prompt };
  });
  // org が参照する全員分の定義があるか(既存定義の続投は definitions 不要とする)
  return {
    org: org as OrgConfig,
    agents,
    summary: typeof p.summary === "string" ? p.summary : "",
  };
}
