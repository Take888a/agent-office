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

| パス | 役割 |
| --- | --- |
| `src/lib/office.ts` | 社員の雇用・進捗追跡・解雇。Claude Agent SDK の `query()` を spawn し、状態は globalThis 上の in-memory ストア(HMR 耐性のため) |
| `src/lib/usage.ts` | AI使用量+コスト試算。集計は [ccusage](https://github.com/ryoppippi/ccusage) に委譲(`npx -y ccusage@latest` を spawn、60秒キャッシュ)。自前パースは重複計上バグの温床なのでやらないこと |
| `src/app/api/employees/**` | 雇用 (POST) / 一覧 (GET) / 解雇 (DELETE) |
| `src/app/api/agents/stream/route.ts` | SSE。office ストアの変更を購読してクライアントへ push |
| `src/app/api/system/route.ts` | 使用量統計(10秒キャッシュ+スキャン直列化) |
| `src/components/OfficeCanvas.tsx` | Canvas 描画(オフィス・ドット絵社員・吹き出し・リソースモニタ)+ サイドバー UI |

データフロー: フォーム → POST /api/employees → `hire()` が Agent SDK セッション起動
→ ツール使用ごとに `notify()` → SSE → キャンバスの吹き出し/名簿が更新。

## 主なカスタマイズポイント(コード内の場所)

- 社員名: `src/lib/office.ts` の `NAMES`
- ツール→活動ラベル(絵文字/日本語): `office.ts` の `TOOL_LABELS`
- エージェント設定(permissionMode, systemPrompt, cwd): `office.ts` の `run()` 内 `query()` オプション
- オフィスレイアウト(デスク数/配置・コーヒーマシン・ドア): `OfficeCanvas.tsx` の `DESKS` / `COFFEE` / `DOOR`
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

- `?demo` クエリで偽社員によるデモモード(実エージェントを起動せず見た目確認できる)
- 動作確認で実際に社員を雇うときは、読み取り専用の軽いタスクを使う
  (例: 「package.json を読んで要約して。ファイル変更はしないで」)。
  サブスクのレート制限を消費するため乱発しない。

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
