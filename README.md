# Trofeo Vision Studio

Thermalright **Trofeo Vision LCD**（USB `0416:5408` / 1920×480）を、純正の
**TRCC** ソフトを使わずに制御・カスタマイズするための自作ドライバ／エディタ。
TRCC の完全置き換えを目指したツールです。

USB プロトコルは [thermalright-trcc-linux](https://github.com/Lexonight1/thermalright-trcc-linux)
プロジェクトの解析成果を参照した、**クリーンルームな Windows 実装**です
（プロトコル解明のクレジットは同プロジェクトに帰属します）。

---

## 機能概要

- **ドラッグ&ドロップ・ダッシュボードエディタ** — Electron + React + Konva 製。
  背景・ウィジェット（時計・テキスト・ゲージ・バー・グラフ等）を自由に配置。
- **ハードウェアセンサー表示** — CPU / GPU / RAM / ネットワーク / ディスクを
  LibreHardwareMonitor から取得。
- **Windows 通知のミラー** — トースト通知を LCD に表示。
- **再生中メディア表示** — SMTC（System Media Transport Controls）から
  再生中の曲・アプリ情報を取得して表示。
- **オーディオビジュアライザー** — システム音声（WASAPI ループバック）を
  バックエンドで解析してスペクトラム表示。
- **アニメ GIF 背景**、**アダプティブ FPS**（負荷に応じた送信レート調整）。
- **トレイ常駐 + ログオン自動起動**（管理者スケジュールタスクとして登録）。

---

## アーキテクチャ

```
  app/  (Electron shell: main.cjs + React/Konva editor)
    │
    │  WebSocket  ws://localhost:8787
    ▼
  server.py + trofeo/
    ├─ device.py         USB トランスポート（pyusb）
    ├─ protocol.py       LY チャンクプロトコル（ハンドシェイク + フレーム分割送信）
    ├─ sensors.py        センサー取得（LibreHardwareMonitor）
    ├─ audio.py          WASAPI ループバック（オーディオビジュアライザー）
    ├─ media.py          SMTC（再生中メディア）
    ├─ notifications.py  UserNotificationListener（Windows 通知）
    ├─ render.py         PIL 画像 -> JPEG
    └─ dashboard.py      Metrics -> ダッシュボード画像
    │
    │  USB bulk
    ▼
  Trofeo Vision LCD (0416:5408 / 1920×480)
```

フロント（Konva Stage）が編集画面と最終フレーム描画の両方を担い、生成した
JPEG フレームを WebSocket でバックエンドへ送り、バックエンドが USB バルク転送で
LCD に流し込みます。

---

## 必要物（リポジトリにコミットされないバイナリ）

これらはライセンス／配布上の理由で Git 管理外です。手動で配置してください。

- **`libs/`** — [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
  **v0.9.6** リリースの DLL 一式（`LibreHardwareMonitorLib.dll` と依存 DLL）を
  コピーして配置。
- **`redist/PawnIO_setup.exe`** — [PawnIO 公式サイト](https://pawnio.eu/) から入手。
  CPU 温度取得に必要。メモリ整合性 / HVCI が有効な環境でも動作します。

---

## 開発

```powershell
pip install -r requirements.txt
```

3 ターミナル構成:

```powershell
# ターミナル 1 — バックエンド（CPU 温度も出すなら管理者 PowerShell で）
python server.py

# ターミナル 2 — フロント開発サーバー（Vite）
cd app
npm install
npm run dev

# ターミナル 3 — Electron シェル
cd app
npm run electron
```

---

## リリースビルド

**(1) バックエンドを変更した場合** — PyInstaller で `server.exe` を再生成
（**リポジトリルート**で実行）:

```powershell
python -m PyInstaller --noconfirm --onedir --name server --distpath build --workpath build\work --specpath build --collect-all libusb_package --collect-all websockets --collect-all pythonnet --collect-all winsdk --collect-all pyaudiowpatch --hidden-import clr server.py
```

**(2) インストーラーのビルド** — electron-builder（NSIS, perMachine）:

```powershell
cd app
npm run dist   # → app/release/ に NSIS インストーラーが出力される
```

インストーラーは **PawnIO のサイレントインストール**と、**管理者ログオンタスクの
登録**（`ensureAutostartTask`）まで自動で行います。

---

## tools/

初回セットアップ・プロトコル検証用のスタンドアロンスクリプト群です。

| スクリプト | 用途 |
|-----------|------|
| `demo.py` | ハンドシェイク + 単色（またはテストパターン）フレーム送信のスモークテスト |
| `probe.py` | libusb からデバイス `0416:5408` が見えるか確認（送信なし） |
| `hs_test.py` | ハンドシェイクのみ（表示は変えず双方向通信を確認） |
| `diag.py` | ハンドシェイク応答 / フレーム ACK のダンプ（ディスクリプタ含む） |
| `monitor.py` | 旧・スタンドアロン常駐ドライバ（Studio 以前の版） |
| `admin_setup.ps1` | TRCC からの移行用（純正 TRCC プロセス／タスクの停止） |

### 初回セットアップ（Zadig で WinUSB へ差し替え）

libusb はデバイスが WinUSB にバインドされている必要があります。
[Zadig](https://zadig.akeo.ie/) を起動 → **Options → List All Devices** →
`0416:5408` を選択 → ドライバに **WinUSB** を選んで **Replace Driver**。

> ⚠️ この操作で**純正 TRCC は使えなくなります**。元に戻すには
> デバイスマネージャーで当該デバイスのドライバを削除 → 再接続で
> 純正ドライバが再導入されます。

---

## プロトコル要点（0416:5408 / LY Bulk）

| 項目 | 値 |
|------|----|
| エンドポイント | OUT `0x09` / IN `0x81` |
| ハンドシェイク | 2048B 送信（`02 FF .. 01 ..`）→ 512B 応答で `[0]=03, [1]=FF, [8]=01` を検証 |
| チャンク | 512B（ヘッダ 16B + ペイロード 496B） |
| バースト | 8 チャンク = 4096B ごとにバルク書き込み、末尾は 2048B |
| 画像形式 | **JPEG** エンコード（LY デバイス仕様） |
| 解像度 | **1920×480** |
