"use client";

import { useEffect, useRef, useState } from "react";
import type { EmployeeInfo } from "@/lib/office";

// ---- 論理解像度(ピクセルアート座標系) ----
const W = 512;
const H = 352;
const WALL_H = 56;

// デスク配置: 4列 x 2行
const DESKS = Array.from({ length: 8 }, (_, i) => ({
  x: 72 + (i % 4) * 112,
  y: 108 + Math.floor(i / 4) * 104,
}));
const COFFEE = { x: 468, y: 84 };
const DOOR = { x: 40, y: H + 20 };

// ---- キャラクターのドット絵 (10x14, 文字=パレットキー) ----
const SPRITE_FRONT = [
  "...HHHH...",
  "..HHHHHH..",
  ".HHHHHHHH.",
  ".HSSSSSSH.",
  ".HSESSESH.",
  "..SSSSSS..",
  "..BBBBBB..",
  ".BBBBBBBB.",
  ".SBBBBBBS.",
  ".SBBBBBBS.",
  "..PPPPPP..",
  "..PP..PP..",
  "..PP..PP..",
  "..KK..KK..",
];
const SPRITE_BACK = [
  "...HHHH...",
  "..HHHHHH..",
  ".HHHHHHHH.",
  ".HHHHHHHH.",
  ".HHHHHHHH.",
  "..SSSSSS..",
  "..BBBBBB..",
  ".BBBBBBBB.",
  ".SBBBBBBS.",
  ".SBBBBBBS.",
  "..PPPPPP..",
  "..PP..PP..",
  "..PP..PP..",
  "..KK..KK..",
];
// タイピング時: 腕を上げる(背面)
const SPRITE_BACK_TYPE = SPRITE_BACK.map((row, i) => {
  if (i === 7) return "SBBBBBBBBS";
  if (i === 8) return ".BBBBBBBB.";
  return row;
});
// 歩行フレーム: 脚を開く
const walkFrame = (base: string[]) =>
  base.map((row, i) => {
    if (i === 11) return ".PP....PP.";
    if (i === 12) return ".PP....PP.";
    if (i === 13) return ".KK....KK.";
    return row;
  });
const SPRITE_FRONT_WALK = walkFrame(SPRITE_FRONT);
const SPRITE_BACK_WALK = walkFrame(SPRITE_BACK);

const OUTFITS = [
  { H: "#4a3728", B: "#c94f4f", P: "#3b4a6b", S: "#f0c8a0" },
  { H: "#2b2b35", B: "#4f7fc9", P: "#444444", S: "#e8b48c" },
  { H: "#8a5a2b", B: "#4fa06a", P: "#5a4632", S: "#f0c8a0" },
  { H: "#c9a227", B: "#8659b5", P: "#3b4a6b", S: "#ffd9b3" },
  { H: "#733a3a", B: "#d98a3d", P: "#2f4f4f", S: "#e8b48c" },
  { H: "#3d5a3d", B: "#c95f8a", P: "#444455", S: "#f0c8a0" },
  { H: "#222244", B: "#3dbdb5", P: "#6b4a3b", S: "#ffd9b3" },
  { H: "#5b4b8a", B: "#b5b53d", P: "#3b3b4a", S: "#e8b48c" },
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---- クライアント側のキャラ状態 ----
interface Actor {
  info: EmployeeInfo;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  deskIndex: number;
  leaving: boolean;
}

type Palette = (typeof OUTFITS)[number];

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: string[],
  x: number,
  y: number,
  pal: Palette,
) {
  for (let r = 0; r < sprite.length; r++) {
    for (let c = 0; c < sprite[r].length; c++) {
      const ch = sprite[r][c];
      if (ch === ".") continue;
      ctx.fillStyle =
        ch === "E" ? "#22222f" : ch === "K" ? "#2b2b2b" : pal[ch as keyof Palette];
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

function drawOffice(ctx: CanvasRenderingContext2D, t: number) {
  // 床
  for (let ty = WALL_H; ty < H; ty += 16) {
    for (let tx = 0; tx < W; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? "#c9a87c" : "#bf9d70";
      ctx.fillRect(tx, ty, 16, 16);
    }
  }
  // 壁
  ctx.fillStyle = "#7a8a99";
  ctx.fillRect(0, 0, W, WALL_H);
  ctx.fillStyle = "#5f6d7a";
  ctx.fillRect(0, WALL_H - 6, W, 6);
  // 窓(夜空+星)
  for (let i = 0; i < 3; i++) {
    const wx = 56 + i * 152;
    ctx.fillStyle = "#3a4a6b";
    ctx.fillRect(wx, 8, 64, 34);
    ctx.fillStyle = "#26334d";
    ctx.fillRect(wx, 26, 64, 16);
    ctx.fillStyle = "#f5f0d0";
    ctx.fillRect(wx + 12, 14, 2, 2);
    ctx.fillRect(wx + 44, 20, 2, 2);
    ctx.fillRect(wx + 30, 12, 2, 2);
    ctx.fillStyle = "#8a97a6";
    ctx.fillRect(wx - 3, 5, 70, 3);
    ctx.fillRect(wx - 3, 42, 70, 3);
    ctx.fillRect(wx + 30, 8, 3, 34);
  }
  // 掛け時計
  ctx.fillStyle = "#e8e4d8";
  ctx.beginPath();
  ctx.arc(480, 24, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#44444f";
  ctx.lineWidth = 2;
  ctx.stroke();
  const now = new Date();
  const mAng = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
  const hAng =
    (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2 -
    Math.PI / 2;
  ctx.strokeStyle = "#44444f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(480, 24);
  ctx.lineTo(480 + Math.cos(mAng) * 8, 24 + Math.sin(mAng) * 8);
  ctx.moveTo(480, 24);
  ctx.lineTo(480 + Math.cos(hAng) * 5, 24 + Math.sin(hAng) * 5);
  ctx.stroke();

  // コーヒーマシン
  ctx.fillStyle = "#4a4a55";
  ctx.fillRect(COFFEE.x - 10, COFFEE.y - 26, 24, 30);
  ctx.fillStyle = "#33333c";
  ctx.fillRect(COFFEE.x - 7, COFFEE.y - 18, 18, 10);
  ctx.fillStyle = Math.floor(t / 500) % 2 === 0 ? "#e05555" : "#7a2f2f";
  ctx.fillRect(COFFEE.x + 8, COFFEE.y - 23, 3, 3);
  ctx.fillStyle = "#e8e4d8";
  ctx.fillRect(COFFEE.x - 2, COFFEE.y - 10, 8, 6);

  // 観葉植物(左右下コーナー)
  for (const px of [16, W - 32]) {
    const py = H - 40;
    ctx.fillStyle = "#a05a2b";
    ctx.fillRect(px, py + 14, 16, 10);
    ctx.fillStyle = "#7a4420";
    ctx.fillRect(px, py + 14, 16, 3);
    ctx.fillStyle = "#3d7a45";
    ctx.fillRect(px + 2, py, 12, 14);
    ctx.fillStyle = "#4f9457";
    ctx.fillRect(px + 5, py - 5, 6, 8);
    ctx.fillRect(px - 1, py + 4, 5, 6);
    ctx.fillRect(px + 12, py + 3, 5, 7);
  }

  // 入口ドアマット
  ctx.fillStyle = "#8a6a4a";
  ctx.fillRect(DOOR.x - 16, H - 8, 32, 8);
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  occupied: boolean,
  t: number,
) {
  // 椅子
  ctx.fillStyle = "#5a5a66";
  ctx.fillRect(x - 7, y + 18, 14, 5);
  // 机
  ctx.fillStyle = "#9a6b3d";
  ctx.fillRect(x - 24, y - 6, 48, 18);
  ctx.fillStyle = "#7d5530";
  ctx.fillRect(x - 24, y + 9, 48, 3);
  // モニタ
  ctx.fillStyle = "#33333c";
  ctx.fillRect(x - 9, y - 16, 18, 13);
  if (occupied) {
    ctx.fillStyle = Math.floor(t / 300) % 3 === 0 ? "#7ad0f0" : "#5ab8dc";
    ctx.fillRect(x - 7, y - 14, 14, 9);
    ctx.fillStyle = "#2b6a85";
    ctx.fillRect(x - 5, y - 12, 8, 1);
    ctx.fillRect(x - 5, y - 10, 10, 1);
    ctx.fillRect(x - 5, y - 8, 6, 1);
  } else {
    ctx.fillStyle = "#1e1e26";
    ctx.fillRect(x - 7, y - 14, 14, 9);
  }
  ctx.fillStyle = "#44444f";
  ctx.fillRect(x - 2, y - 3, 4, 2);
  // キーボード
  ctx.fillStyle = "#c4c4cc";
  ctx.fillRect(x - 7, y + 2, 14, 4);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

interface UsageStats {
  available: boolean;
  window5h: { tokens: number; cost: number; peakTokens: number } | null;
  today: { tokens: number; cost: number } | null;
  month: { total: number; claude: number; codex: number; tokens: number } | null;
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${n}`;
}

function drawMonitor(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  fontPx: number,
  fontFamily: string,
  stats: UsageStats | null,
  working: number,
  totalCost: number,
) {
  const green = "#5aff8a";
  const dim = "#3d7a55";
  const pad = 6;
  const rowH = fontPx + 5;

  ctx.save();
  ctx.textAlign = "left";
  ctx.font = `${fontPx}px ${fontFamily}`;

  // --- 行を先に組み立て、実測幅からパネルサイズを決める(はみ出し防止) ---
  const w5 = stats?.window5h ?? null;
  const ratio = w5 && w5.peakTokens > 0 ? w5.tokens / w5.peakTokens : 0;

  type Row =
    | { kind: "text"; text: string; color: string }
    | { kind: "bar"; label: string; value: string; ratio: number };

  const rows: Row[] = [{ kind: "text", text: "■ AI USAGE (ccusage)", color: dim }];
  if (w5) {
    rows.push({ kind: "bar", label: "5h窓", value: fmtTokens(w5.tokens), ratio });
    rows.push({
      kind: "text",
      text: ` ピーク比${Math.round(ratio * 100)}%  ≈$${w5.cost.toFixed(2)}`,
      color: dim,
    });
  } else {
    rows.push({ kind: "text", text: "5h窓 --", color: dim });
  }
  rows.push(
    stats?.today
      ? {
          kind: "text",
          text: `今日 ${fmtTokens(stats.today.tokens)}  ≈$${stats.today.cost.toFixed(2)}`,
          color: green,
        }
      : { kind: "text", text: "今日 --", color: dim },
  );
  if (stats?.month) {
    const m = stats.month;
    const breakdown =
      m.codex > 0.005
        ? ` (CL$${m.claude.toFixed(0)}+CX$${m.codex.toFixed(0)})`
        : "";
    rows.push({
      kind: "text",
      text: `今月 ≈$${m.total.toFixed(2)}${breakdown}`,
      color: green,
    });
  } else {
    rows.push({ kind: "text", text: "今月 --", color: dim });
  }
  rows.push({
    kind: "text",
    text: `稼働 ${working}名  Σ$${totalCost.toFixed(2)}`,
    color: green,
  });

  const BAR_W = fontPx * 7;
  const GAP = 6;
  const rowWidth = (row: Row) =>
    row.kind === "text"
      ? ctx.measureText(row.text).width
      : ctx.measureText(row.label).width + GAP + BAR_W + GAP + ctx.measureText(row.value).width;
  const panelW = Math.ceil(Math.max(...rows.map(rowWidth))) + pad * 2;
  const panelH = rowH * rows.length + pad * 2;
  const px = cw - panelW - 10;
  const py = ch - panelH - 10;

  // --- 描画 ---
  ctx.fillStyle = "rgba(12,14,18,0.85)";
  ctx.strokeStyle = "#3d5a45";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, panelH, 4);
  ctx.fill();
  ctx.stroke();

  let y = py + pad + fontPx;
  for (const row of rows) {
    if (row.kind === "text") {
      ctx.fillStyle = row.color;
      ctx.fillText(row.text, px + pad, y);
    } else {
      ctx.fillStyle = green;
      ctx.fillText(row.label, px + pad, y);
      const bx = px + pad + ctx.measureText(row.label).width + GAP;
      const bh = fontPx * 0.7;
      ctx.strokeStyle = dim;
      ctx.strokeRect(bx, y - bh + 1, BAR_W, bh);
      ctx.fillStyle =
        row.ratio > 0.85 ? "#ff5a5a" : row.ratio > 0.6 ? "#ffc94f" : green;
      ctx.fillRect(
        bx + 1,
        y - bh + 2,
        Math.max(0, (BAR_W - 2) * Math.min(1, row.ratio)),
        bh - 2,
      );
      ctx.fillStyle = green;
      ctx.fillText(row.value, bx + BAR_W + GAP, y);
    }
    y += rowH;
  }
  ctx.restore();
}

const STATUS_BADGE: Record<
  EmployeeInfo["status"],
  { label: string; className: string }
> = {
  working: { label: "作業中", className: "bg-sky-900/60 text-sky-200" },
  done: { label: "完了", className: "bg-emerald-900/60 text-emerald-200" },
  error: { label: "中断", className: "bg-rose-900/60 text-rose-200" },
};

export default function OfficeCanvas({ demo }: { demo: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actorsRef = useRef<Map<string, Actor>>(new Map());
  const deskOwnerRef = useRef<(string | null)[]>(Array(DESKS.length).fill(null));
  const [connected, setConnected] = useState(false);
  const [employees, setEmployees] = useState<EmployeeInfo[]>([]);
  const [task, setTask] = useState("");
  const [hiring, setHiring] = useState(false);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const statsRef = useRef<UsageStats | null>(null);
  const employeesRef = useRef<EmployeeInfo[]>([]);
  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  // リソースモニタ用の使用量統計を定期取得
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/system");
        if (!stopped && res.ok) statsRef.current = await res.json();
      } catch {
        // サーバー停止中などは無視
      }
    };
    void poll();
    const timer = setInterval(poll, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // 社員一覧の受信(SSE or デモ)
  useEffect(() => {
    const applyEmployees = (list: EmployeeInfo[]) => {
      const actors = actorsRef.current;
      const owners = deskOwnerRef.current;
      const seen = new Set<string>();

      for (const info of list) {
        seen.add(info.id);
        const existing = actors.get(info.id);
        if (existing) {
          existing.info = info;
          existing.leaving = false;
          continue;
        }
        const deskIndex = owners.findIndex((o) => o === null);
        if (deskIndex >= 0) owners[deskIndex] = info.id;
        actors.set(info.id, {
          info,
          x: DOOR.x,
          y: DOOR.y,
          targetX: 0,
          targetY: 0,
          deskIndex,
          leaving: false,
        });
      }
      // 消えた社員は退勤
      for (const [id, actor] of actors) {
        if (!seen.has(id) && !actor.leaving) {
          actor.leaving = true;
          if (actor.deskIndex >= 0) owners[actor.deskIndex] = null;
        }
      }
      setEmployees(list);
    };

    if (demo) {
      queueMicrotask(() => setConnected(true));
      const acts = [
        { emoji: "💻", activity: "コーディング中", detail: "OfficeCanvas.tsx" },
        { emoji: "🔍", activity: "コード検索中", detail: "useEffect" },
        { emoji: "⚡", activity: "コマンド実行中", detail: "npm test" },
        { emoji: "🌐", activity: "Web調査中", detail: "SSE reconnect" },
        { emoji: "✅", activity: "タスク完了", detail: "" },
      ];
      const names = ["ユキ", "タロウ", "ハナ", "ケン", "ミオ"];
      const tasks = [
        "READMEを整備する",
        "テストを追加する",
        "バグ修正",
        "リファクタリング",
        "依存を更新する",
      ];
      const mk = (i: number): EmployeeInfo => {
        const a = acts[Math.floor(Math.random() * acts.length)];
        return {
          id: `demo-${i}`,
          name: names[i % names.length],
          task: tasks[i % tasks.length],
          status: a.emoji === "✅" ? "done" : "working",
          emoji: a.emoji,
          activity: a.activity,
          detail: a.detail,
          report: a.emoji === "✅" ? "デモ用の完了報告です。" : "",
          hiredAt: Date.now(),
          finishedAt: null,
          costUsd: null,
        };
      };
      let list = Array.from({ length: 5 }, (_, i) => mk(i));
      applyEmployees(list);
      const timer = setInterval(() => {
        list = list.map((e, i) => (Math.random() < 0.3 ? { ...mk(i) } : e));
        applyEmployees(list);
      }, 4000);
      return () => clearInterval(timer);
    }

    const es = new EventSource("/api/agents/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        applyEmployees(JSON.parse(ev.data) as EmployeeInfo[]);
      } catch {
        // 不正なフレームは無視
      }
    };
    return () => es.close();
  }, [demo]);

  // 描画ループ
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = document.createElement("canvas");
    scene.width = W;
    scene.height = H;
    const sctx = scene.getContext("2d")!;

    let raf = 0;
    let last = performance.now();
    const fontFamily =
      getComputedStyle(document.body).fontFamily || "'DotGothic16', monospace";

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      // タブが非アクティブで raf が間引かれても実時間ぶん歩けるよう、広めにクランプ
      const dt = Math.min(2000, t - last);
      last = t;

      const parent = canvas.parentElement!;
      const scale = Math.min(parent.clientWidth / W, parent.clientHeight / H);
      const cw = Math.floor(W * scale);
      const ch = Math.floor(H * scale);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }

      const actors = actorsRef.current;

      // --- 移動更新 ---
      for (const [id, actor] of actors) {
        const { info } = actor;
        if (actor.leaving) {
          actor.targetX = DOOR.x;
          actor.targetY = DOOR.y;
        } else if (info.status !== "working") {
          // 完了/中断 → コーヒーマシン周りで一服
          const h = hashCode(id);
          actor.targetX = COFFEE.x - 16 - (h % 28);
          actor.targetY = COFFEE.y + 4 + (h % 22);
        } else if (actor.deskIndex >= 0) {
          const desk = DESKS[actor.deskIndex];
          actor.targetX = desk.x;
          actor.targetY = desk.y + 12;
        } else {
          // デスク満席: 中央待機
          const h = hashCode(id);
          actor.targetX = 200 + (h % 120);
          actor.targetY = 240 + (h % 50);
        }
        const dx = actor.targetX - actor.x;
        const dy = actor.targetY - actor.y;
        const dist = Math.hypot(dx, dy);
        const speed = 0.06 * dt;
        if (dist > speed) {
          actor.x += (dx / dist) * speed;
          actor.y += (dy / dist) * speed;
        } else {
          actor.x = actor.targetX;
          actor.y = actor.targetY;
          if (actor.leaving) actors.delete(id);
        }
      }

      // --- シーン描画(論理解像度) ---
      drawOffice(sctx, t);
      const sorted = [...actors.values()].sort((a, b) => a.y - b.y);
      DESKS.forEach((desk, i) => {
        const ownerId = deskOwnerRef.current[i];
        const owner = ownerId ? actors.get(ownerId) : undefined;
        const occupied =
          !!owner &&
          !owner.leaving &&
          owner.info.status === "working" &&
          Math.hypot(owner.x - owner.targetX, owner.y - owner.targetY) < 2;
        drawDesk(sctx, desk.x, desk.y, occupied, t);
      });
      for (const actor of sorted) {
        const pal = OUTFITS[hashCode(actor.info.id) % OUTFITS.length];
        const moving =
          Math.hypot(actor.x - actor.targetX, actor.y - actor.targetY) > 2;
        const atDesk =
          !moving && actor.info.status === "working" && actor.deskIndex >= 0;
        const bob = moving && Math.floor(t / 250) % 2 === 0 ? -1 : 0;
        let sprite: string[];
        if (moving) {
          const base = actor.targetY < actor.y ? SPRITE_BACK : SPRITE_FRONT;
          sprite =
            Math.floor(t / 180) % 2 === 0
              ? base
              : base === SPRITE_BACK
                ? SPRITE_BACK_WALK
                : SPRITE_FRONT_WALK;
        } else if (atDesk) {
          sprite = Math.floor(t / 350) % 2 === 0 ? SPRITE_BACK : SPRITE_BACK_TYPE;
        } else {
          sprite = SPRITE_FRONT;
        }
        drawSprite(
          sctx,
          sprite,
          Math.round(actor.x - 5),
          Math.round(actor.y - 7 + bob),
          pal,
        );
      }

      // --- 画面へ拡大転写 ---
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(scene, 0, 0, cw, ch);

      // --- テキストオーバーレイ(ネイティブ解像度で鮮明に) ---
      const fontPx = Math.max(10, Math.round(3.6 * scale));
      ctx.font = `${fontPx}px ${fontFamily}`;
      ctx.textAlign = "center";
      for (const actor of sorted) {
        const sx = actor.x * scale;
        const sy = actor.y * scale;
        // 名前(足元)
        const name = truncate(actor.info.name, 10);
        ctx.fillStyle = "rgba(20,20,30,0.75)";
        const nw = ctx.measureText(name).width + 8;
        ctx.fillRect(sx - nw / 2, sy + 8 * scale, nw, fontPx + 4);
        ctx.fillStyle = "#f5f0e0";
        ctx.fillText(name, sx, sy + 8 * scale + fontPx);

        // 吹き出し(頭上)
        if (!actor.leaving) {
          const text = `${actor.info.emoji} ${truncate(
            actor.info.detail || actor.info.activity,
            16,
          )}`;
          const bw = ctx.measureText(text).width + 12;
          const bh = fontPx + 8;
          const bx = Math.min(Math.max(sx, bw / 2 + 4), cw - bw / 2 - 4);
          const by = sy - 12 * scale - bh;
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.beginPath();
          ctx.roundRect(bx - bw / 2, by, bw, bh, 4);
          ctx.fill();
          ctx.strokeStyle = "#55556a";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(sx - 3, by + bh);
          ctx.lineTo(sx + 3, by + bh);
          ctx.lineTo(sx, by + bh + 5);
          ctx.closePath();
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fill();
          ctx.fillStyle = "#26262f";
          ctx.fillText(text, bx, by + fontPx + 2);
        }
      }

      // --- リソースモニタ(右下常時表示) ---
      const emps = employeesRef.current;
      drawMonitor(
        ctx,
        cw,
        ch,
        fontPx,
        fontFamily,
        statsRef.current,
        emps.filter((e) => e.status === "working").length,
        emps.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
      );

      if (actors.size === 0) {
        ctx.font = `${fontPx * 1.6}px ${fontFamily}`;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText("社員募集中 📋", cw / 2, ch / 2);
        ctx.font = `${fontPx}px ${fontFamily}`;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(
          "上のフォームからタスクを渡すと社員が出勤します",
          cw / 2,
          ch / 2 + fontPx * 2,
        );
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hireEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || hiring || demo) return;
    setHiring(true);
    try {
      await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      setTask("");
    } finally {
      setHiring(false);
    }
  };

  const fireEmployee = async (id: string) => {
    if (demo) return;
    await fetch(`/api/employees/${id}`, { method: "DELETE" });
  };

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <h1 className="font-bold tracking-widest text-amber-100">
          ⌂ AGENT OFFICE
        </h1>
        <form onSubmit={hireEmployee} className="flex min-w-0 flex-1 gap-2">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="タスクを入力して社員を雇う(例: READMEに使い方を追記して)"
            className="min-w-0 flex-1 rounded border border-amber-100/30 bg-white/5 px-3 py-1.5 text-amber-50 placeholder:text-amber-100/40 focus:border-amber-100/60 focus:outline-none"
            disabled={demo}
          />
          <button
            type="submit"
            disabled={hiring || !task.trim() || demo}
            className="rounded bg-amber-200 px-4 py-1.5 font-bold text-[#1a1622] disabled:opacity-40"
          >
            {hiring ? "採用中…" : "雇う"}
          </button>
        </form>
        <div className="flex items-center gap-3 text-amber-100/80">
          <span>{demo ? "DEMO" : connected ? "● LIVE" : "○ 接続中…"}</span>
          <span>出勤 {employees.length} 名</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-2">
          <canvas ref={canvasRef} style={{ imageRendering: "pixelated" }} />
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 p-3 text-sm">
          <h2 className="mb-2 text-xs tracking-widest text-amber-100/60">
            社員名簿
          </h2>

          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["作業中", employees.filter((e) => e.status === "working").length, "text-sky-300"],
                ["完了", employees.filter((e) => e.status === "done").length, "text-emerald-300"],
                ["中断", employees.filter((e) => e.status === "error").length, "text-rose-300"],
              ] as const
            ).map(([label, n, color]) => (
              <div
                key={label}
                className="rounded border border-white/10 bg-white/5 py-1.5"
              >
                <div className={`text-lg font-bold ${color}`}>{n}</div>
                <div className="text-xs text-amber-100/50">{label}</div>
              </div>
            ))}
          </div>

          {employees.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-amber-100/50">
              <span className="text-3xl">📋</span>
              <p className="text-xs leading-relaxed">
                まだ誰もいません。
                <br />
                上のフォームからタスクを渡して
                <br />
                最初の社員を雇いましょう。
              </p>
            </div>
          )}

          <ul className="space-y-2">
              {employees.map((emp) => {
                const badge = STATUS_BADGE[emp.status];
                const open = openReport === emp.id;
                return (
                  <li
                    key={emp.id}
                    className="rounded border border-white/10 bg-white/5 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-50">{emp.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <button
                        onClick={() => fireEmployee(emp.id)}
                        className="ml-auto rounded px-1.5 py-0.5 text-xs text-rose-300 hover:bg-rose-900/40"
                        title={
                          emp.status === "working" ? "作業を中断" : "退勤させる"
                        }
                      >
                        {emp.status === "working" ? "■ 中断" : "退勤"}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-amber-100/70">{emp.task}</p>
                    <p className="mt-1 text-xs text-amber-100/50">
                      {emp.emoji} {emp.detail || emp.activity}
                    </p>
                    {emp.report && (
                      <div className="mt-1">
                        <button
                          onClick={() => setOpenReport(open ? null : emp.id)}
                          className="text-xs text-sky-300 hover:underline"
                        >
                          {open ? "▼ 報告を閉じる" : "▶ 報告を読む"}
                        </button>
                        {open && (
                          <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-xs text-amber-50">
                            {emp.report}
                          </pre>
                        )}
                        {emp.costUsd !== null && (
                          <p className="mt-1 text-xs text-amber-100/40">
                            コスト: ${emp.costUsd.toFixed(4)}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
