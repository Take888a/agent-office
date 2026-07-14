import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * トークン使用量とコスト試算は ccusage (https://github.com/ryoppippi/ccusage) に委譲する。
 * - トークンは Claude Code / Codex のローカルトランスクリプト由来(message id で重複排除済み)
 * - コストはAPI単価換算の試算値。サブスク利用時は実請求額ではない
 * 別のコマンドを使いたい場合は環境変数 CCUSAGE_COMMAND で差し替え可能。
 */
const [CC_CMD, ...CC_BASE_ARGS] = (
  process.env.CCUSAGE_COMMAND ?? "npx -y ccusage@latest"
).split(/\s+/);

export interface UsageStats {
  available: boolean;
  /**
   * 現在の5時間レート制限ウィンドウ。peakTokens は直近7日の最大ブロック(バーの分母)。
   * resetsAt はウィンドウのリセット時刻(epoch ms)。アクティブなブロックがなければ null
   */
  window5h: {
    tokens: number;
    cost: number;
    peakTokens: number;
    resetsAt: number | null;
  } | null;
  today: { tokens: number; cost: number } | null;
  /** 今月のコスト試算(USD)。claude/codex はモデル名で振り分け */
  month: { total: number; claude: number; codex: number; tokens: number } | null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
const CACHE_MS = 60_000;

interface CcBlock {
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
  isGap?: boolean;
  totalTokens?: number;
  costUSD?: number;
  tokenCounts?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

/**
 * cache read はコスト0.1倍・レート制限への寄与も小さいのに量が支配的(9割以上)なので、
 * 表示用トークンは input + output + cache生成 のみを数える。
 */
function effectiveBlockTokens(b: CcBlock): number {
  const t = b.tokenCounts;
  if (!t) return b.totalTokens ?? 0;
  return (
    (t.inputTokens ?? 0) +
    (t.outputTokens ?? 0) +
    (t.cacheCreationInputTokens ?? 0)
  );
}

interface CcModelBreakdown {
  modelName?: string;
  cost?: number;
}

interface CcRow {
  date?: string;
  period?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  totalCost?: number;
  modelBreakdowns?: CcModelBreakdown[];
}

function effectiveRowTokens(row: CcRow): number {
  return (
    (row.inputTokens ?? 0) +
    (row.outputTokens ?? 0) +
    (row.cacheCreationTokens ?? 0)
  );
}

async function ccusage(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(
    CC_CMD,
    [...CC_BASE_ARGS, ...args, "--json"],
    { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

async function fetchWindow5h(): Promise<UsageStats["window5h"]> {
  const data = (await ccusage(["blocks"])) as { blocks?: CcBlock[] };
  const blocks = (data.blocks ?? []).filter((b) => !b.isGap);
  const active = blocks.find((b) => b.isActive);
  const cutoff = Date.now() - WEEK_MS;
  let peakTokens = 0;
  for (const b of blocks) {
    const start = b.startTime ? Date.parse(b.startTime) : NaN;
    if (!Number.isNaN(start) && start >= cutoff) {
      peakTokens = Math.max(peakTokens, effectiveBlockTokens(b));
    }
  }
  const resetsAt = active?.endTime ? Date.parse(active.endTime) : NaN;
  return {
    tokens: active ? effectiveBlockTokens(active) : 0,
    cost: active?.costUSD ?? 0,
    peakTokens,
    resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
  };
}

async function fetchToday(): Promise<UsageStats["today"]> {
  const today = ymd(new Date());
  const data = (await ccusage(["daily", "--since", today])) as {
    daily?: CcRow[];
  };
  let tokens = 0;
  let cost = 0;
  for (const row of data.daily ?? []) {
    tokens += effectiveRowTokens(row);
    cost += row.totalCost ?? 0;
  }
  return { tokens, cost };
}

async function fetchMonth(): Promise<UsageStats["month"]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const data = (await ccusage(["monthly", "--since", ymd(monthStart)])) as {
    monthly?: CcRow[];
  };
  let total = 0;
  let claude = 0;
  let codex = 0;
  let tokens = 0;
  for (const row of data.monthly ?? []) {
    if (row.period && row.period !== currentPeriod) continue;
    total += row.totalCost ?? 0;
    tokens += effectiveRowTokens(row);
    for (const m of row.modelBreakdowns ?? []) {
      const cost = m.cost ?? 0;
      if ((m.modelName ?? "").startsWith("claude")) claude += cost;
      else codex += cost;
    }
  }
  return { total, claude, codex, tokens };
}

// 直列化 + 短期キャッシュ(ccusage の起動は毎回数秒かかるため)
const g = globalThis as unknown as {
  __usageCacheV3?: { at: number; stats: UsageStats };
  __usageInflight?: Promise<UsageStats> | null;
};

export function getUsageStats(): Promise<UsageStats> {
  const cached = g.__usageCacheV3;
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return Promise.resolve(cached.stats);
  }
  if (!g.__usageInflight) {
    g.__usageInflight = scanUsage().finally(() => {
      g.__usageInflight = null;
    });
  }
  return g.__usageInflight;
}

async function scanUsage(): Promise<UsageStats> {
  const [window5h, today, month] = await Promise.all([
    fetchWindow5h().catch(() => null),
    fetchToday().catch(() => null),
    fetchMonth().catch(() => null),
  ]);
  const stats: UsageStats = {
    available: window5h !== null || today !== null || month !== null,
    window5h,
    today,
    month,
  };
  if (stats.available) {
    g.__usageCacheV3 = { at: Date.now(), stats };
  }
  return stats;
}
