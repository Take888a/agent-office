"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OfficeState, OrderInfo } from "@/lib/office";
import type { OrgView } from "@/lib/org";

// ---- 論理解像度(ピクセルアート座標系) ----
// 最小サイズ。組織が大きい場合は computeLayout がキャンバスを広げる
// (画面には縮小フィットされるため、チーム数・人数が増えても崩れない)
const MIN_W = 512;
const MIN_H = 352;
const WALL_H = 56;

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
const SPRITE_BACK_TYPE = SPRITE_BACK.map((row, i) => {
  if (i === 7) return "SBBBBBBBBS";
  if (i === 8) return ".BBBBBBBB.";
  return row;
});
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
type Palette = (typeof OUTFITS)[number];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---- 組織からのレイアウト計算 ----

interface Seat {
  agent: string;
  displayName: string;
  role: string;
  x: number; // デスク中心
  y: number;
}

interface Zone {
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  seats: Map<string, Seat>;
  zones: Zone[];
  /** 休憩コーナーのラグ範囲(コーヒーマシンの置き場所) */
  breakRect: { x: number; y: number; w: number; h: number };
  /** キャンバスの論理サイズ(組織規模に応じて広がる) */
  w: number;
  h: number;
  door: { x: number; y: number };
  coffee: { x: number; y: number };
}

// デスク1席の占有サイズ(横58 x 縦68)とゾーン内の余白
const SEAT_W = 58;
const SEAT_ROW_H = 68;
const ZONE_PAD = 6;
const ZONE_HEAD = 40; // ラグ上端〜最初のデスク中心
const ZONE_FOOT = 26; // 最後のデスク中心〜ラグ下端(椅子+名札ぶん)

/**
 * 組織からオフィスレイアウトを計算する。
 * target を渡すと、その論理サイズいっぱいに要素を配り直す
 * (画面アスペクト比に合わせてレターボックスを作らないため)。
 */
function computeLayout(org: OrgView, target?: { w: number; h: number }): Layout {
  const seats = new Map<string, Seat>();
  const zones: Zone[] = [];
  const teams = org.teams;

  // 各チームが必要とするセルサイズ(デスクは詰めずに常に定間隔で並べる)
  const perRowOf = (members: number) => Math.min(3, Math.max(1, members));
  const cellW =
    Math.max(90, ...teams.map((t) => perRowOf(t.members.length) * SEAT_W + 32)) +
    ZONE_PAD * 2;
  const cellH =
    Math.max(
      80,
      ...teams.map(
        (t) =>
          ZONE_HEAD +
          (Math.ceil(t.members.length / perRowOf(t.members.length)) - 1) *
            SEAT_ROW_H +
          ZONE_FOOT,
      ),
    ) +
    ZONE_PAD * 2 +
    8;

  // 休憩コーナー(上段右): コーヒーマシンの置き場所。
  // 待機中の社員はオフィス中を自由に歩き回るので、ここは小さな固定サイズでよい
  const breakW = 110;
  const breakH = 62;

  // グリッド列数: 使い勝手のよい幅(チーム3列ぶん)に収まるなら横に並べ、
  // 超える規模では正方形に近いグリッドにする
  const areaX = 16;
  const colsBySqrt = Math.max(1, Math.ceil(Math.sqrt(teams.length)));
  const colsByWidth = Math.max(1, Math.floor((MIN_W - areaX * 2) / cellW));
  const cols = Math.min(
    Math.max(1, teams.length),
    Math.max(colsBySqrt, colsByWidth),
  );
  const rows = teams.length > 0 ? Math.ceil(teams.length / cols) : 0;

  // 幅はコンテンツから算出(無駄な余白を作らない):
  // チームグリッド幅 と 上段(管理職を中心に置いた上で休憩室が入る幅) の大きい方
  const wTeams = areaX * 2 + cols * cellW;
  const wTop = 2 * (breakW + 68);
  const w = Math.max(320, wTeams, wTop, target?.w ?? 0);
  // 余り幅はセルへ均等配分(ゾーンが全幅に広がる)
  const effCellW = (w - areaX * 2) / cols;

  // 上段: 人事(左)・管理職(中央)・休憩室(右)
  seats.set(org.hr.agent, {
    agent: org.hr.agent,
    displayName: org.hr.displayName,
    role: "人事",
    x: 72,
    y: 96,
  });
  zones.push({ name: "人事", color: "#8a8a99", x: 28, y: 72, w: 88, h: 66 });

  seats.set(org.orchestrator.agent, {
    agent: org.orchestrator.agent,
    displayName: org.orchestrator.displayName,
    role: "管理職",
    x: w / 2,
    y: 96,
  });
  zones.push({ name: "管理職", color: "#c9a227", x: w / 2 - 44, y: 72, w: 88, h: 66 });

  const breakX = w - breakW - 16;
  const breakY = 68;
  zones.push({
    name: "休憩室",
    color: "#8a6a4a",
    x: breakX,
    y: breakY,
    w: breakW,
    h: breakH,
  });

  // チーム領域は上段(人事/管理職/休憩室の下端)の直下から
  const areaY = Math.max(146, breakY + breakH + 10);

  // 高さもコンテンツから算出。target 指定時は余り高さをセルへ均等配分
  const hNat = areaY + rows * cellH + 14;
  const h = Math.max(hNat, target?.h ?? 0);
  const effCellH =
    rows > 0 ? cellH + (h - hNat) / rows : cellH;

  // チームゾーン: 最終行は中央寄せ、ラグはセル内で中央寄せ
  teams.forEach((team, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? teams.length - row * cols : cols;
    const rowOffset = ((cols - inRow) * effCellW) / 2;
    const zx = areaX + rowOffset + col * effCellW;
    const zy = areaY + row * effCellH;

    const perRow = perRowOf(team.members.length);
    const deskRows = Math.max(1, Math.ceil(team.members.length / perRow));
    const rugW = Math.max(90, perRow * SEAT_W + 32);
    const rugH = ZONE_HEAD + (deskRows - 1) * SEAT_ROW_H + ZONE_FOOT;
    const rugX = zx + (effCellW - rugW) / 2;
    const rugY = zy + Math.max(ZONE_PAD, (effCellH - rugH) / 2);
    zones.push({
      name: team.name,
      color: team.color,
      x: rugX,
      y: rugY,
      w: rugW,
      h: rugH,
    });

    team.members.forEach((m, j) => {
      const r = Math.floor(j / perRow);
      const c = j % perRow;
      const seatsInRow = Math.min(perRow, team.members.length - r * perRow);
      const cx = rugX + rugW / 2 + (c - (seatsInRow - 1) / 2) * SEAT_W;
      const cy = rugY + ZONE_HEAD + r * SEAT_ROW_H;
      seats.set(m.agent, {
        agent: m.agent,
        displayName: m.displayName,
        role: m.role,
        x: cx,
        y: cy,
      });
    });
  });

  return {
    seats,
    zones,
    breakRect: { x: breakX, y: breakY, w: breakW, h: breakH },
    w,
    h,
    door: { x: 40, y: h + 20 },
    coffee: { x: breakX + breakW - 20, y: breakY + 42 },
  };
}

/** オフィス内のうろつき先をランダムに選ぶ(デスク周りは避ける) */
function pickWanderSpot(layout: Layout): { x: number; y: number } {
  for (let i = 0; i < 12; i++) {
    const x = 24 + Math.random() * (layout.w - 48);
    const y = WALL_H + 34 + Math.random() * (layout.h - WALL_H - 56);
    let clear = true;
    for (const seat of layout.seats.values()) {
      if (Math.abs(x - seat.x) < 36 && y > seat.y - 28 && y < seat.y + 32) {
        clear = false;
        break;
      }
    }
    if (clear) return { x, y };
  }
  // 空きが見つからなければ休憩コーナーへ
  return {
    x: layout.breakRect.x + layout.breakRect.w / 2 - 10,
    y: layout.breakRect.y + layout.breakRect.h - 14,
  };
}

// ---- 描画ヘルパー ----

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

function drawOffice(ctx: CanvasRenderingContext2D, t: number, layout: Layout) {
  const { w, h, zones, coffee, door } = layout;
  // 床
  for (let ty = WALL_H; ty < h; ty += 16) {
    for (let tx = 0; tx < w; tx += 16) {
      ctx.fillStyle = ((tx + ty) / 16) % 2 === 0 ? "#c9a87c" : "#bf9d70";
      ctx.fillRect(tx, ty, 16, 16);
    }
  }
  // チームラグ
  for (const z of zones) {
    ctx.fillStyle = z.color + "33";
    ctx.strokeStyle = z.color + "88";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(z.x, z.y, z.w, z.h, 3);
    ctx.fill();
    ctx.stroke();
  }
  // 壁
  ctx.fillStyle = "#7a8a99";
  ctx.fillRect(0, 0, w, WALL_H);
  ctx.fillStyle = "#5f6d7a";
  ctx.fillRect(0, WALL_H - 6, w, 6);
  // 窓(キャンバス幅に応じて繰り返す。右端は時計・コーヒー用に空ける)
  for (let wx = 56; wx + 64 <= w - 96; wx += 152) {
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
  const clockX = w - 32;
  ctx.fillStyle = "#e8e4d8";
  ctx.beginPath();
  ctx.arc(clockX, 24, 10, 0, Math.PI * 2);
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
  ctx.moveTo(clockX, 24);
  ctx.lineTo(clockX + Math.cos(mAng) * 8, 24 + Math.sin(mAng) * 8);
  ctx.moveTo(clockX, 24);
  ctx.lineTo(clockX + Math.cos(hAng) * 5, 24 + Math.sin(hAng) * 5);
  ctx.stroke();

  // コーヒーマシン
  ctx.fillStyle = "#4a4a55";
  ctx.fillRect(coffee.x - 10, coffee.y - 26, 24, 30);
  ctx.fillStyle = "#33333c";
  ctx.fillRect(coffee.x - 7, coffee.y - 18, 18, 10);
  ctx.fillStyle = Math.floor(t / 500) % 2 === 0 ? "#e05555" : "#7a2f2f";
  ctx.fillRect(coffee.x + 8, coffee.y - 23, 3, 3);
  ctx.fillStyle = "#e8e4d8";
  ctx.fillRect(coffee.x - 2, coffee.y - 10, 8, 6);

  // 観葉植物(右下コーナー)
  const px = w - 32;
  const py = h - 40;
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

  // 入口ドアマット
  ctx.fillStyle = "#8a6a4a";
  ctx.fillRect(door.x - 16, h - 8, 32, 8);
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  occupied: boolean,
  t: number,
) {
  ctx.fillStyle = "#5a5a66";
  ctx.fillRect(x - 7, y + 18, 14, 5);
  ctx.fillStyle = "#9a6b3d";
  ctx.fillRect(x - 24, y - 6, 48, 18);
  ctx.fillStyle = "#7d5530";
  ctx.fillRect(x - 24, y + 9, 48, 3);
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

// ---- クライアント側のキャラ状態 ----

interface Actor {
  agent: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** 直前フレームの状態(作業⇔休憩の遷移検知用) */
  mode?: "working" | "idle";
  /** 次に気まぐれ行動を起こす時刻 */
  idleUntil: number;
  /** 休憩中の演出(☕💬🎵💤など) */
  emote: { icon: string; until: number } | null;
}

const ORDER_BADGE: Record<
  OrderInfo["status"],
  { label: string; className: string }
> = {
  working: { label: "進行中", className: "bg-sky-900/60 text-sky-200" },
  done: { label: "完了", className: "bg-emerald-900/60 text-emerald-200" },
  error: { label: "中断", className: "bg-rose-900/60 text-rose-200" },
};

export default function OfficeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OfficeState | null>(null);
  /** コンテンツ由来の自然サイズのレイアウト(スケール計算の基準) */
  const naturalRef = useRef<Layout | null>(null);
  /** 画面サイズに合わせて引き延ばした表示用レイアウト */
  const layoutRef = useRef<Layout | null>(null);
  const layoutKeyRef = useRef("");
  const actorsRef = useRef<Map<string, Actor>>(new Map());
  /** クリック位置→論理座標変換用に現在のスケールを保持 */
  const scaleRef = useRef(1);

  const [connected, setConnected] = useState(false);
  const [office, setOffice] = useState<OfficeState | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  /** クリックで選択中の社員(モーダル表示) */
  const [selected, setSelected] = useState<string | null>(null);
  /** 右下のオーケストレータ指示フォームの開閉 */
  const [formOpen, setFormOpen] = useState(false);

  // 状態の受信(SSE)
  useEffect(() => {
    const es = new EventSource("/api/agents/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const s = JSON.parse(ev.data) as OfficeState;
        stateRef.current = s;
        const natural = computeLayout(s.org);
        naturalRef.current = natural;
        layoutKeyRef.current = ""; // 表示用レイアウトを次フレームで再計算
        // 新入社員はドアから出勤(行き先は描画ループが状態に応じて決める)
        const actors = actorsRef.current;
        const seats = natural.seats;
        for (const agent of seats.keys()) {
          if (!actors.has(agent)) {
            actors.set(agent, {
              agent,
              x: natural.door.x,
              y: natural.door.y,
              targetX: natural.door.x,
              targetY: natural.door.y,
              idleUntil: 0,
              emote: null,
            });
          }
        }
        for (const agent of [...actors.keys()]) {
          if (!seats.has(agent)) actors.delete(agent);
        }
        setOffice(s);
      } catch {
        // 不正なフレームは無視
      }
    };
    return () => es.close();
  }, []);

  // リソースモニタ用の使用量統計を定期取得
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/system");
        if (!stopped && res.ok) setStats(await res.json());
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

  // 描画ループ
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = document.createElement("canvas");
    scene.width = MIN_W;
    scene.height = MIN_H;
    const sctx = scene.getContext("2d")!;

    let raf = 0;
    let last = performance.now();
    const fontFamily =
      getComputedStyle(document.body).fontFamily || "'DotGothic16', monospace";

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(2000, t - last);
      last = t;

      const officeState = stateRef.current;
      const actors = actorsRef.current;
      const parent = canvas.parentElement!;
      const pw = Math.max(1, parent.clientWidth);
      const ph = Math.max(1, parent.clientHeight);

      // 画面をレターボックスなしで埋める: 自然サイズから等倍スケールを決め、
      // 画面ぶんの論理サイズにレイアウトを配り直す
      const natural = naturalRef.current;
      if (natural && stateRef.current) {
        const fit = Math.min(pw / natural.w, ph / natural.h);
        const targetW = Math.ceil(pw / fit);
        const targetH = Math.ceil(ph / fit);
        const key = `${targetW}x${targetH}`;
        if (layoutKeyRef.current !== key) {
          layoutRef.current = computeLayout(stateRef.current.org, {
            w: targetW,
            h: targetH,
          });
          layoutKeyRef.current = key;
        }
      }
      const layout = layoutRef.current;

      const lw = layout?.w ?? MIN_W;
      const lh = layout?.h ?? MIN_H;
      if (scene.width !== lw || scene.height !== lh) {
        scene.width = lw;
        scene.height = lh;
      }

      const scale = Math.min(pw / lw, ph / lh);
      scaleRef.current = scale;
      const cw = Math.floor(lw * scale);
      const ch = Math.floor(lh * scale);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }

      // --- 移動更新(作業中はデスクへ、待機中はオフィス内を自由に) ---
      // 管理職と人事はどんなプロジェクトにもいる常設ポジションなので常時着席
      if (layout && officeState) {
        const deskBound = new Set([
          officeState.org.orchestrator.agent,
          officeState.org.hr.agent,
        ]);
        for (const actor of actors.values()) {
          const working =
            officeState.statuses[actor.agent]?.state === "working";
          const seat = layout.seats.get(actor.agent);

          if (seat && working) {
            actor.targetX = seat.x;
            actor.targetY = seat.y + 12;
            if (actor.mode !== "working") {
              actor.mode = "working";
              actor.emote = null;
            }
            continue;
          }

          if (seat && deskBound.has(actor.agent)) {
            // 常時着席組: 席は動かさず、たまに机上の小芝居だけ
            actor.targetX = seat.x;
            actor.targetY = seat.y + 12;
            actor.mode = "idle";
            if (t > actor.idleUntil) {
              if (Math.random() < 0.5) {
                actor.emote = {
                  icon: Math.random() < 0.5 ? "☕" : "📋",
                  until: t + 4000,
                };
              }
              actor.idleUntil = t + 8000 + Math.random() * 10000;
            }
            continue;
          }

          // チーム社員の休憩: オフィス内を自由に歩き回る
          if (actor.mode !== "idle") {
            actor.mode = "idle";
            actor.emote = null;
            const first = pickWanderSpot(layout);
            actor.targetX = first.x;
            actor.targetY = first.y;
            actor.idleUntil = t + 4000 + Math.random() * 6000;
          } else if (t > actor.idleUntil) {
            const roll = Math.random();
            if (roll < 0.35) {
              // オフィス内をぶらぶら
              const next = pickWanderSpot(layout);
              actor.targetX = next.x;
              actor.targetY = next.y;
            } else if (roll < 0.55) {
              // コーヒーを淹れに行く
              actor.targetX = layout.coffee.x - 16;
              actor.targetY = layout.coffee.y + 4;
              actor.emote = { icon: "☕", until: t + 6000 };
            } else if (roll < 0.75) {
              // 近くの同僚と立ち話
              const others = [...actors.values()].filter(
                (a) => a !== actor && a.mode === "idle" && !deskBound.has(a.agent),
              );
              if (others.length > 0) {
                const buddy = others[Math.floor(Math.random() * others.length)];
                actor.targetX = buddy.x + (actor.x < buddy.x ? -14 : 14);
                actor.targetY = buddy.y;
                actor.emote = { icon: "💬", until: t + 5000 };
                buddy.emote = { icon: "💬", until: t + 5500 };
              }
            } else {
              // その場でひと息
              actor.emote = {
                icon: Math.random() < 0.5 ? "🎵" : "💤",
                until: t + 4000,
              };
            }
            actor.idleUntil = t + 7000 + Math.random() * 9000;
          }
        }
      }
      for (const actor of actors.values()) {
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
        }
      }

      // --- シーン描画(論理解像度) ---
      if (layout) {
        drawOffice(sctx, t, layout);
      } else {
        sctx.fillStyle = "#bf9d70";
        sctx.fillRect(0, 0, lw, lh);
      }

      if (layout && officeState) {
        const sortedSeats = [...layout.seats.values()].sort((a, b) => a.y - b.y);
        for (const seat of sortedSeats) {
          const status = officeState.statuses[seat.agent];
          const actor = actors.get(seat.agent);
          const seated =
            !!actor &&
            Math.hypot(actor.x - actor.targetX, actor.y - actor.targetY) < 2;
          drawDesk(sctx, seat.x, seat.y, seated && status?.state === "working", t);
        }
        const sortedActors = [...actors.values()].sort((a, b) => a.y - b.y);
        for (const actor of sortedActors) {
          const status = officeState.statuses[actor.agent];
          const pal = OUTFITS[hashCode(actor.agent) % OUTFITS.length];
          const moving =
            Math.hypot(actor.x - actor.targetX, actor.y - actor.targetY) > 2;
          let sprite: string[];
          if (moving) {
            const base = actor.targetY < actor.y ? SPRITE_BACK : SPRITE_FRONT;
            sprite =
              Math.floor(t / 180) % 2 === 0
                ? base
                : base === SPRITE_BACK
                  ? SPRITE_BACK_WALK
                  : SPRITE_FRONT_WALK;
          } else if (status?.state === "working") {
            sprite =
              Math.floor(t / 350) % 2 === 0 ? SPRITE_BACK : SPRITE_BACK_TYPE;
          } else if (
            actor.agent === officeState.org.orchestrator.agent ||
            actor.agent === officeState.org.hr.agent
          ) {
            // 管理職・人事は休憩中も自席に座っている
            sprite = SPRITE_BACK;
          } else {
            // 休憩中: こちらを向いて立つ
            sprite = SPRITE_FRONT;
          }
          const bob = moving && Math.floor(t / 250) % 2 === 0 ? -1 : 0;
          drawSprite(
            sctx,
            sprite,
            Math.round(actor.x - 5),
            Math.round(actor.y - 7 + bob),
            pal,
          );
        }
      }

      // --- 画面へ拡大転写 ---
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(scene, 0, 0, cw, ch);

      // --- テキストオーバーレイ ---
      const fontPx = Math.max(10, Math.round(3.6 * scale));
      ctx.font = `${fontPx}px ${fontFamily}`;
      ctx.textAlign = "center";

      // ゾーンラベル
      if (layout) {
        for (const z of layout.zones) {
          ctx.fillStyle = "rgba(20,20,30,0.6)";
          const label = z.name;
          const lw = ctx.measureText(label).width + 8;
          const lx = (z.x + 4) * scale;
          const ly = (z.y + 3) * scale;
          ctx.textAlign = "left";
          ctx.fillRect(lx, ly, lw, fontPx + 4);
          ctx.fillStyle = "#f5f0e0";
          ctx.fillText(label, lx + 4, ly + fontPx);
        }
        ctx.textAlign = "center";
      }

      // 名前と吹き出し
      if (layout && officeState) {
        const sortedActors = [...actors.values()].sort((a, b) => a.y - b.y);
        for (const actor of sortedActors) {
          const seat = layout.seats.get(actor.agent);
          const status = officeState.statuses[actor.agent];
          if (!seat) continue;
          const sx = actor.x * scale;
          const sy = actor.y * scale;
          // 名前+職種の2行ラベル
          const name = truncate(seat.displayName, 10);
          const role = truncate(seat.role, 12);
          const rolePx = Math.max(9, Math.round(fontPx * 0.85));
          const nw =
            Math.max(
              ctx.measureText(name).width,
              ctx.measureText(role).width * (rolePx / fontPx),
            ) + 8;
          const labelY = sy + 8 * scale;
          ctx.fillStyle = "rgba(20,20,30,0.75)";
          ctx.fillRect(sx - nw / 2, labelY, nw, fontPx + rolePx + 7);
          ctx.fillStyle = "#f5f0e0";
          ctx.fillText(name, sx, labelY + fontPx);
          ctx.font = `${rolePx}px ${fontFamily}`;
          ctx.fillStyle = "#c9bfa0";
          ctx.fillText(role, sx, labelY + fontPx + rolePx + 3);
          ctx.font = `${fontPx}px ${fontFamily}`;

          // 休憩中の演出(☕💬🎵💤): 絵文字だけの小さな吹き出し
          if (
            status?.state !== "working" &&
            actor.emote &&
            t < actor.emote.until
          ) {
            const icon = actor.emote.icon;
            const bw = ctx.measureText(icon).width + 10;
            const bh = fontPx + 6;
            const bx = sx;
            const by = sy - 11 * scale - bh;
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.beginPath();
            ctx.roundRect(bx - bw / 2, by, bw, bh, 4);
            ctx.fill();
            ctx.strokeStyle = "#55556a";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = "#26262f";
            ctx.fillText(icon, bx, by + fontPx + 1);
          }

          if (status?.state === "working") {
            const bubbleText = `${status.emoji} ${truncate(
              status.detail || status.activity,
              16,
            )}`;
            const bw = ctx.measureText(bubbleText).width + 12;
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
            ctx.fillText(bubbleText, bx, by + fontPx + 2);
          }
        }
      }

    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);


  // キャンバスクリック: キャラに当たっていればモーダルを開く
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = scaleRef.current || 1;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const actor of actorsRef.current.values()) {
      const dx = x - actor.x;
      const dy = y - actor.y;
      // スプライト+足元ラベルのあたり判定
      if (Math.abs(dx) <= 13 && dy >= -12 && dy <= 22) {
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = actor.agent;
        }
      }
    }
    if (best) setSelected(best);
  };

  // 組織変更で選択中の社員が消えていたらモーダルは表示しない
  const selectedAgent =
    selected && office && selected in office.statuses ? selected : null;

  const cancelOrder = async (id: string) => {
    await fetch(`/api/orders/${id}`, { method: "DELETE" });
  };

  const orders = office?.orders ?? [];
  const workingCount = office
    ? Object.values(office.statuses).filter((s) => s.state === "working").length
    : 0;
  const totalCost = orders.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <h1 className="font-bold tracking-widest text-amber-100">
          ⌂ AGENT OFFICE
        </h1>
        <p className="min-w-0 flex-1 truncate text-xs text-amber-100/40">
          社員をクリックすると詳細と直接指示、右下のボタンから管理職への指示
        </p>
        <nav className="flex items-center gap-2">
          <Link
            href="/employees"
            className="rounded border border-amber-100/30 px-3 py-1.5 text-amber-100/90 hover:bg-white/10"
          >
            社員一覧
          </Link>
          <Link
            href="/org"
            className="rounded border border-amber-100/30 px-3 py-1.5 text-amber-100/90 hover:bg-white/10"
          >
            組織編成
          </Link>
          <span className="pl-1 text-amber-100/60">
            {connected ? "● LIVE" : "○ 接続中…"}
          </span>
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="block cursor-pointer"
            style={{ imageRendering: "pixelated" }}
          />

          {/* オーナー → 管理職への指示フォーム(トグル・DOMオーバーレイ) */}
          <div className="absolute bottom-3 right-3 z-10">
            {formOpen ? (
              <OrchestratorForm
                office={office}
                onClose={() => setFormOpen(false)}
              />
            ) : (
              <button
                onClick={() => setFormOpen(true)}
                className="rounded-full bg-amber-200 px-4 py-2 text-sm font-bold text-[#1a1622] shadow-lg hover:bg-amber-100"
              >
                📣 指示を出す
              </button>
            )}
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 p-3 text-sm">
          <UsagePanel stats={stats} working={workingCount} totalCost={totalCost} />

          <h2 className="mb-2 text-xs tracking-widest text-amber-100/60">
            オーダー履歴
          </h2>

          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["進行中", orders.filter((o) => o.status === "working").length, "text-sky-300"],
                ["完了", orders.filter((o) => o.status === "done").length, "text-emerald-300"],
                ["中断", orders.filter((o) => o.status === "error").length, "text-rose-300"],
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

          {orders.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-amber-100/50">
              <span className="text-3xl">📋</span>
              <p className="text-xs leading-relaxed">
                まだオーダーはありません。
                <br />
                右下の「📣 指示を出す」から管理職に
                <br />
                指示を出すとチームが動き出します。
              </p>
            </div>
          )}

          <ul className="space-y-2">
            {orders.map((order) => {
              const badge = ORDER_BADGE[order.status];
              const open = openReport === order.id;
              return (
                <li
                  key={order.id}
                  className="rounded border border-white/10 bg-white/5 p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-50">
                      → {order.targetName}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <button
                      onClick={() => cancelOrder(order.id)}
                      className="ml-auto rounded px-1.5 py-0.5 text-xs text-rose-300 hover:bg-rose-900/40"
                      title={order.status === "working" ? "中断する" : "履歴から削除"}
                    >
                      {order.status === "working" ? "■ 中断" : "削除"}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-amber-100/70">{order.text}</p>
                  {order.report && (
                    <div className="mt-1">
                      <button
                        onClick={() => setOpenReport(open ? null : order.id)}
                        className="text-xs text-sky-300 hover:underline"
                      >
                        {open ? "▼ 報告を閉じる" : "▶ 報告を読む"}
                      </button>
                      {open && (
                        <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-xs text-amber-50">
                          {order.report}
                        </pre>
                      )}
                      {order.costUsd !== null && (
                        <p className="mt-1 text-xs text-amber-100/40">
                          コスト: ${order.costUsd.toFixed(4)}
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

      {selectedAgent && office && (
        <EmployeeModal
          office={office}
          agent={selectedAgent}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ---- サイドバーの使用量パネル ----

function UsagePanel({
  stats,
  working,
  totalCost,
}: {
  stats: UsageStats | null;
  working: number;
  totalCost: number;
}) {
  const w5 = stats?.window5h ?? null;
  const ratio = w5 && w5.peakTokens > 0 ? Math.min(1, w5.tokens / w5.peakTokens) : 0;
  const barColor =
    ratio > 0.85 ? "bg-rose-400" : ratio > 0.6 ? "bg-amber-300" : "bg-emerald-400";
  return (
    <section className="mb-4 rounded border border-emerald-900/80 bg-[#0c0e12] p-2.5 text-xs text-emerald-300">
      <div className="mb-2 text-emerald-600">■ AI USAGE (ccusage)</div>
      {w5 ? (
        <>
          <div className="flex items-center gap-2">
            <span className="shrink-0">5h窓</span>
            <div className="h-2.5 min-w-0 flex-1 rounded-sm border border-emerald-800 bg-black/40">
              <div
                className={`h-full rounded-sm ${barColor}`}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
            <span className="shrink-0">{fmtTokens(w5.tokens)}</span>
          </div>
          <div className="mt-0.5 text-emerald-700">
            ピーク比{Math.round(ratio * 100)}% ≈${w5.cost.toFixed(2)}
          </div>
        </>
      ) : (
        <div className="text-emerald-700">5h窓 --</div>
      )}
      <div className="mt-1.5 flex justify-between">
        <span>
          今日 {stats?.today ? `${fmtTokens(stats.today.tokens)} ≈$${stats.today.cost.toFixed(2)}` : "--"}
        </span>
      </div>
      <div className="flex justify-between">
        <span>
          今月 {stats?.month
            ? `≈$${stats.month.total.toFixed(2)}${
                stats.month.codex > 0.005
                  ? ` (CL$${stats.month.claude.toFixed(0)}+CX$${stats.month.codex.toFixed(0)})`
                  : ""
              }`
            : "--"}
        </span>
      </div>
      <div className="mt-1.5 border-t border-emerald-900/60 pt-1.5">
        稼働 {working}名  Σ${totalCost.toFixed(2)}
      </div>
    </section>
  );
}

// ---- 右下のオーケストレータ指示フォーム ----

function OrchestratorForm({
  office,
  onClose,
}: {
  office: OfficeState | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const managerName = office?.org.orchestrator.displayName ?? "管理職";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target: "orchestrator" }),
      });
      setText("");
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-80 rounded-lg border border-amber-100/30 bg-[#241f30]/95 p-3 text-sm shadow-xl backdrop-blur"
    >
      <div className="mb-2 flex items-center text-xs text-amber-100/70">
        📣 管理職({managerName})へ指示
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded px-1.5 text-amber-100/60 hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder="例: READMEの誤字を直して、QAに確認させて"
        className="w-full rounded border border-amber-100/30 bg-white/5 px-2 py-1.5 text-amber-50 placeholder:text-amber-100/40 focus:border-amber-100/60 focus:outline-none"
      />
      <button
        type="submit"
        disabled={sending || !text.trim()}
        className="mt-2 w-full rounded bg-amber-200 py-1.5 font-bold text-[#1a1622] disabled:opacity-40"
      >
        {sending ? "送信中…" : "指示する"}
      </button>
    </form>
  );
}

// ---- 社員モーダル(クリックで開く) ----

function EmployeeModal({
  office,
  agent,
  onClose,
}: {
  office: OfficeState;
  agent: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState("");

  const org = office.org;
  const isOrchestrator = agent === org.orchestrator.agent;
  const isHr = agent === org.hr.agent;

  let displayName = "";
  let role = "";
  let teamName = "";
  if (isOrchestrator) {
    displayName = org.orchestrator.displayName;
    role = "管理職(オーケストレータ)";
  } else if (isHr) {
    displayName = org.hr.displayName;
    role = "人事(採用・チーム編成)";
  } else {
    for (const team of org.teams) {
      const m = team.members.find((mm) => mm.agent === agent);
      if (m) {
        displayName = m.displayName;
        role = m.role;
        teamName = team.name;
        break;
      }
    }
  }
  const description = org.agents[agent]?.description ?? "";
  const status = office.statuses[agent];
  const currentOrder = status?.orderId
    ? office.orders.find((o) => o.id === status.orderId)
    : undefined;
  const relatedOrders = office.orders
    .filter((o) =>
      isOrchestrator ? o.target === "orchestrator" : o.target === agent,
    )
    .slice(0, 5);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      if (isHr) {
        await fetch("/api/org/hr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        setSentNote("編成の検討を依頼しました。提案が届いたら組織編成ページで承認できます。");
      } else {
        await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            target: isOrchestrator ? "orchestrator" : agent,
          }),
        });
        setSentNote("指示を送りました。");
      }
      setText("");
    } finally {
      setSending(false);
    }
  };

  const formLabel = isHr
    ? "組織編成を相談する"
    : isOrchestrator
      ? "指示を出す(チームへの割り振りはお任せ)"
      : "直接指示(この社員が単独で対応)";
  const placeholder = isHr
    ? "例: ECサイト案件が始まる。フロント重視の体制にしたい"
    : isOrchestrator
      ? "例: READMEの誤字を直して、QAに確認させて"
      : "例: package.json を読んで依存関係を要約して";

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/15 bg-[#241f30] p-4 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-amber-50">{displayName}</span>
          <span className="text-xs text-amber-100/60">
            {role}
            {teamName ? ` / ${teamName}` : ""}
          </span>
          <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-amber-100/40">
            {agent}
          </code>
          <button
            onClick={onClose}
            className="ml-auto rounded px-2 py-1 text-amber-100/60 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 rounded border border-white/10 bg-white/5 p-2">
          <div className="text-xs text-amber-100/50">いまの状態</div>
          {status?.state === "working" ? (
            <div className="mt-1 text-sky-200">
              {status.emoji} {status.detail || status.activity}
            </div>
          ) : (
            <div className="mt-1 text-amber-100/70">☕ 休憩中</div>
          )}
          {currentOrder && (
            <div className="mt-1 text-xs text-amber-100/60">
              担当中: {currentOrder.text}
            </div>
          )}
        </div>

        {description && (
          <div className="mt-2 rounded border border-white/10 bg-white/5 p-2">
            <div className="text-xs text-amber-100/50">得意分野</div>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
              {description}
            </p>
          </div>
        )}

        {isHr && office.proposal && (
          <div className="mt-2 rounded border border-amber-200/40 bg-amber-200/10 p-2 text-xs">
            📋 編成提案が届いています —{" "}
            <Link href="/org" className="text-sky-300 underline">
              組織編成ページで確認・承認
            </Link>
          </div>
        )}
        {isHr && office.hrBusy && (
          <div className="mt-2 text-xs text-sky-300">
            🗂️ 編成案を検討中です…(完了すると組織編成ページに提案が届きます)
          </div>
        )}

        {relatedOrders.length > 0 && (
          <div className="mt-2 rounded border border-white/10 bg-white/5 p-2">
            <div className="text-xs text-amber-100/50">最近のオーダー</div>
            <ul className="mt-1 space-y-1">
              {relatedOrders.map((o) => {
                const badge = ORDER_BADGE[o.status];
                return (
                  <li key={o.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="min-w-0 text-amber-100/70">{o.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <form onSubmit={submit} className="mt-3">
          <div className="mb-1 text-xs text-amber-100/60">{formLabel}</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={placeholder}
            className="w-full rounded border border-amber-100/30 bg-white/5 px-2 py-1.5 text-amber-50 placeholder:text-amber-100/40 focus:border-amber-100/60 focus:outline-none"
            disabled={isHr && office.hrBusy}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={sending || !text.trim() || (isHr && office.hrBusy)}
              className="rounded bg-amber-200 px-4 py-1.5 font-bold text-[#1a1622] disabled:opacity-40"
            >
              {sending ? "送信中…" : isHr ? "相談する" : "指示する"}
            </button>
            {sentNote && (
              <span className="text-xs text-emerald-300">{sentNote}</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
