# Agent Office

AI社員(Claude Agent SDK 製エージェント)を雇って働かせるバーチャルオフィス。
**このプロジェクトは「AI社員オフィス」のテンプレートとして配布することを目指している。**

## 最重要方針: テンプレ化

今後のすべての作業は「他人が clone してすぐ自分のオフィスとして使える」状態を
ゴールに置くこと。具体的には:

- **ユーザー固有の値をハードコードしない。** パス・名前・チーム構成・タスク例などは
  定数/設定ファイル/環境変数に切り出し、デフォルト値で動くようにする。
- **カスタマイズポイントを明示する。** 見た目(社員名・服装パレット・オフィスレイアウト)や
  挙動(permissionMode・監視対象プロバイダ)を変えたい人がどこを触ればよいか、
  README とコードコメントで辿れるようにする。
- **機能追加時は「設定で無効化/差し替えできるか」を考える。** 例: Codex 使用量表示は
  データがなければ自動で `--` 表示になる、のような graceful degradation を保つ。
- **環境依存を増やさない。** `claude` ログイン済みなら追加設定ゼロで動く、が理想。
  新たに必須の環境変数や外部サービスを導入する場合は README に必ず記載し、
  未設定でも壊れないフォールバックを用意する。
- **README を配布物として維持する。** 機能を変えたら README の使い方・注意も同時に更新。

## アーキテクチャ

**組織モデル**: オーナー(ユーザー) → 管理職(オーケストレータ) → チームの社員。
社員は常駐で、実体は Claude Code のサブエージェント定義 `.claude/agents/*.md`。
チーム編成は `office/org.json`(役職別でも案件別でも編成できる前提を崩さない)。

| パス | 役割 |
| --- | --- |
| `office/org.json` | チーム編成(orchestrator / hr / teams)。社員は agent 名で `.claude/agents/<agent>.md` を参照 |
| `.claude/agents/*.md` | 社員の実体。frontmatter の description は管理職の委譲判断に使われる |
| `src/lib/org.ts` | 組織の読み書き、人事提案の検証・適用(applyOrg) |
| `src/lib/office.ts` | オーダー実行。管理職セッションを `query()` で起動し、Task ツールの `subagent_type` と `parent_tool_use_id` で「どの社員が今なにをしているか」を追跡。人事の提案→承認→適用フローも担う。状態は globalThis 上の in-memory ストア(HMR 耐性) |
| `src/lib/usage.ts` | AI使用量+コスト試算。集計は [ccusage](https://github.com/ryoppippi/ccusage) に委譲(`npx -y ccusage@latest` を spawn、60秒キャッシュ)。自前パースは重複計上バグの温床なのでやらないこと |
| `src/app/api/orders/**` | オーダー投入 (POST) / 中断・削除 (DELETE) |
| `src/app/api/org/**` | 組織取得 / 人事オーダー (hr) / 提案の承認・却下 (proposal) |
| `src/app/api/agents/stream/route.ts` | SSE。OfficeState(org+statuses+orders+proposal) を push |
| `src/app/api/system/route.ts` | 使用量統計 |
| `src/components/OfficeCanvas.tsx` | オフィス描画(管理職席・チームゾーン・リソースモニタ)+ オーダーUI |
| `src/components/EmployeeRoster.tsx` | 社員一覧ページ (/employees) |
| `src/components/OrgEditor.tsx` | 組織編成ページ (/org)。人事への相談と提案の承認/却下 |

データフロー: オーダー送信 → POST /api/orders → 管理職セッション起動 →
Task 委譲を検知して社員の状態を更新 → `notify()` → SSE → キャンバス反映。
組織変更: /org で人事に相談 → 提案(JSON)を state に保持 → 承認で
`.claude/agents` と org.json に書き込み → orgキャッシュ無効化 → 全画面に反映。

## 主なカスタマイズポイント(コード内の場所)

- 初期組織: `office/org.json` と `.claude/agents/*.md`(テンプレのデフォルト編成)
- ツール→活動ラベル(絵文字/日本語): `office.ts` の `TOOL_LABELS`
- エージェント設定(permissionMode, systemPrompt, cwd): `office.ts` の `runOrder()` / `submitHrOrder()` 内 `query()` オプション
- オフィスレイアウト(席配置アルゴリズム・コーヒーマシン・ドア): `OfficeCanvas.tsx` の `computeLayout()` / `COFFEE` / `DOOR`
- キャラの服装パレット: `OfficeCanvas.tsx` の `OUTFITS`
- 使用量集計コマンド: 環境変数 `CCUSAGE_COMMAND`(デフォルト `npx -y ccusage@latest`)
- リソースモニタの表示項目: `OfficeCanvas.tsx` の `drawMonitor()`
  - トークン数は input+output+cache生成 の実効値(cache read は量が支配的なのに
    コスト0.1倍・レート制限寄与小のため除外)。コストは ccusage の全込み試算(USD, API換算)
  - 5h窓バーの100%は「直近7日で最大のブロック」= 自分のピーク比

## 開発

```bash
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
```

### Git 運用

- **こまめにコミットする。** 機能や修正がひとまとまり動いたら都度コミット。
  大きな作業を未コミットのまま積み上げない。
- **プッシュ前に必ずビルド検証する。** `npm run build` が通ることを確認してから push。
  (lint / `npx tsc --noEmit` は日常のコミット単位でも回す)

- オーダーを出さなければ実エージェントは起動しない(常駐社員は待機表示のみ)ので、
  見た目の確認はトークン消費ゼロでできる。
- 動作確認で実際にオーダーを出すときは、読み取り専用の軽いタスクを使う
  (例: 「ユキに package.json を読ませて一言で要約させて」)。
  管理職経由は管理職+社員の2セッション分を消費するため乱発しない。

## 注意事項

- エージェントは `permissionMode: "bypassPermissions"` で cwd(このリポジトリ)を
  自由に変更できる。テンプレとしてはこの危険性を README で必ず告知し続けること。
- 認証: API キー未設定ならバンドルされた Claude Code バイナリがユーザー自身の
  サブスク OAuth を使う。**個人のローカル利用は公式に許容**だが、
  第三者にサービスとして提供する形(他人に claude.ai ログインさせる等)は不可。
  テンプレ配布時も「使う人が各自自分の環境で動かす」前提を崩さない。
- 社員の状態は dev サーバーのメモリ上のみ。永続化を入れる場合はテンプレ利用者が
  無効化できる形で。
- UI は日本語。i18n を頼まれるまでは日本語のままでよいが、文言は一箇所に
  まとまっていると差し替えやすい(新規文言追加時に意識する)。
