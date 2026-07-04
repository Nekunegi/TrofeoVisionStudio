# Trofeo Vision Studio (Electron アプリ)

背景画像やウィジェット(時計・センサー・ゲージ・グラフ・ビジュアライザー等)を
配置して LCD レイアウトを作るエディタ + トレイ常駐ドライバのフロントエンド。
**「エディタ＝レンダラー」**構成で、Konva Stage が編集画面と最終フレーム
(`toDataURL('image/jpeg')`)の両方を担う。

## スタック

Vite + React 19 + TypeScript + react-konva、Electron シェル(`electron/main.cjs`)。
生成した JPEG フレームは WebSocket で Python バックエンド(`../server.py`)へ送信。
リリース版はバックエンドを PyInstaller 製 `server.exe` として同梱し、
Electron が子プロセスとして起動する(electron-builder の extraResources)。

## 開発起動

```powershell
# 1) バックエンド(CPU温度も出すなら管理者で)
cd ..
python server.py

# 2) フロント(Vite 開発サーバー)
npm run dev

# 3) Electron シェル(vite 起動後に)
npm run electron
```

ヘッダの `WS: open` / `LCD: connected` が緑、`target/out fps` が動いていれば、
編集内容がそのまま LCD にストリーミングされている。

## データフロー

```
React/Konva Stage(1920x480) --toDataURL(jpeg)--> WS(binary) --> server.py --> LCD
        ▲ sensors/media/notification/spectrum(json) <-- WS <-- backend
```

## 主なファイル

- `electron/main.cjs` … Electron メイン: backend 起動、トレイ、単一インスタンス
  (昇格常駐へのシグナルファイル)、自動起動タスク登録、`app://` 配信、デバッグフック
- `src/rafShim.ts` … 非表示ウィンドウの rAF スロットル(~1fps)対策。
  **main.tsx の先頭 import 必須**(Konva がロード時に rAF を束縛するため)
- `src/App.tsx` … エディタ UI、undo/redo、アダプティブ FPS の送信ループ
- `src/DashboardStage.tsx` … Konva ステージ(編集 + フレーム出力)、ドラッグスナップ
- `src/dashboard/` … 描画部品(テーマ定数、GlassPanel、トースト/天気/メディアカード、
  ビジュアライザー)
- `src/components/` … サイドバー UI(ウィジェットプロパティ、センサー表示、プリセット)
- `src/hooks/useSmoothedSensors.ts` … センサー値のイージング
- `src/useBackend.ts` … WebSocket 接続(自動再接続、`?backend=` 上書き対応)
- `src/useAudioSpectrum.ts` … ビジュアライザー入力(バックエンド WASAPI 優先、
  レンダラー内キャプチャへフォールバック)
- `src/useAnimatedImage.ts` … アニメ GIF 背景のデコード
- `src/layoutStore.ts` / `src/bgStore.ts` … レイアウト永続化(localStorage)と
  背景メディア(IndexedDB)
- `src/types.ts` … Layout / Widget データモデル(LAYOUT_VERSION とマイグレーション)

## ビルド

```powershell
npm run build   # tsc + vite build
npm run lint    # oxlint
npm run pack    # win-unpacked (動作確認用)
npm run dist    # NSIS インストーラー → release/
```
