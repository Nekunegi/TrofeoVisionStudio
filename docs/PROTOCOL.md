# LY-bulk USB Protocol (0416:5408)

Thermalright Trofeo Vision 9.16 LCD の USB プロトコル仕様。
純正 TRCC ソフトが使用する **「LY USB chunked-bulk」プロトコル**の
Windows 実装向けリファレンスです。

プロトコル解析の一次資料は
[Lexonight1/thermalright-trcc-linux](https://github.com/Lexonight1/thermalright-trcc-linux)
プロジェクトによる `USBLCDNEW.dll` のリバースエンジニアリング成果です。
本ドキュメントはそれをもとにした **クリーンルーム実装** (この
リポジトリの [`trofeo/protocol.py`](../trofeo/protocol.py) と
[`trofeo/device.py`](../trofeo/device.py)) の観点で
実際にワイヤーを流れるバイトを整理したものです。

## デバイス概要

| 項目 | 値 |
|------|-----|
| VID | `0x0416` (Thermalright / Lian Tech) |
| PID | `0x5408` ("Trofeo Vision 9.16 LCD", "LY" 系) |
| 解像度 | 1920 × 480 |
| 画像形式 | JPEG (LY 系デバイスの仕様) |
| インターフェース | Vendor-specific interface 0 |
| エンドポイント | Bulk OUT `0x09` / Bulk IN `0x81` |
| Max packet size | 512 バイト |
| Windows ドライバ | **WinUSB**(Zadigで差し替え必須) |

## ハンドシェイク

**方向**: ホスト → デバイス、続いてデバイス → ホスト

**送信**: 2048 バイト固定

```
オフセット  内容           長さ
0            0x02           1   (コマンドマーカー)
1            0xFF           1
2..7         0x00 x 6       6   (padding)
8            0x01           1
9..15        0x00 x 7       7   (padding)
16..2047     0x00 x 2032    2032 (payload zeros)
```

**応答**: 512 バイト固定。次のパターンを検証する:

```
resp[0] == 0x03    (成功応答マーカー)
resp[1] == 0xFF
resp[8] == 0x01
```

パスしなければ即エラー。応答のうちバイト 20 以降にはデバイス独自の
シリアル/仕様バイト列が入る (例: バイト20-24 に幅 1920 の LE u16
=`0x0780`)。本実装ではそこまでは検証しません。

## フレーム転送

ハンドシェイク成功後、任意タイミングで JPEG エンコード済みの
1920 × 480 フレームバイト列を送信できます。フレーム全体を **512 バイトの
チャンク**に分割し、**4 の倍数個** になるようゼロパディングして送ります。

### チャンク構造

各チャンクは **16 バイトのヘッダ + 496 バイトのペイロード = 512 バイト固定**。

```
オフセット  内容                                長さ
0            0x01                                 1   (フレームチャンクマーカー)
1            0xFF                                 1
2..5         フレーム全長 (LE u32)                4
6..7         このチャンクのペイロード長 (LE u16)   2   (フルなら 496)
8            0x01                                 1
9..10        総チャンク数 (LE u16)                2   (4の倍数)
11..12       このチャンクのインデックス (LE u16)  2   (0 始まり)
13..15       0x00 x 3                             3   (padding)
16..511      ペイロード (JPEG バイト列)          496
```

### バースト書き込み

チャンクは **8 個ずつ 4096 バイトのバルク書き込み** に束ねて送信します。
末尾に 4 チャンク (2048 バイト) が余った場合は 1 回の 2048 バイト書き込みで
送信します。

**なぜ 4 の倍数か**: `n_total` を 4 の倍数にパディングすることで、末尾は
必ず「フルバースト 4096B」または「末尾バースト 2048B」のいずれかになり、
中途半端なサイズの書き込みが発生しない設計です。

### 例: 500 バイトの JPEG フレーム

- 実チャンク: 2 個 (496 + 4 = 500)
- パディング後: 4 個 (次の 4 の倍数)
- 送信バッファ: 4 × 512 = **2048 バイト**
- 書き込み回数: **1 回** (2048B)
- ヘッダの `total = 500`、チャンク 0 の `payload_len = 496`、チャンク 1 の
  `payload_len = 4`、チャンク 2, 3 の `payload_len = 0`
- 各チャンクの `n_total = 4`、`index` はそれぞれ 0, 1, 2, 3

### 例: 5000 バイトの JPEG フレーム

- 実チャンク: 11 個 (10×496 + 40 = 5000)
- パディング後: 12 個
- 送信バッファ: 12 × 512 = **6144 バイト**
- 書き込み回数: **2 回** (4096B + 2048B)

## フレーム ACK

最後のバースト書き込み後、デバイスから 512 バイトの ACK を読み取ります。
本実装ではバイトの内容は検証していません(現状 `read` して破棄)。
将来の拡張で状態通知として使う可能性があるので、無視するにしても読み捨てが
必要です。

## エラーからのリカバリ

`send_frame` の途中で `USBError` が発生した場合の推奨手順:

1. **USB port reset** を実行 (`libusb_reset_device()` 相当) — mid-transfer
   で死んだ前プロセスが残したパネル側のバッファ待ちをクリア
2. デバイスハンドルを閉じて再オープン
3. ハンドシェイクをやり直し
4. リクエストされたフレームを再送

本実装 (`server.py:DeviceManager.send_frame`) はこのフローを 1 回だけ
自動リトライします。

## 純正 TRCC との差分

純正 TRCC の解析 (Lexonight1 プロジェクトによる) では、以下の追加コマンド
タイプ (`SSCRM_CMD_TYPE_*`) が定義されていることが判明していますが、
バイトレイアウトは USBLCDNEW.dll には含まれていません:

| コマンド ID | 用途 | 実装状況 |
|-----------|------|---------|
| `SSCRM_CMD_TYPE_FRAME` (0x01) | フレーム転送 | 本実装 |
| `SSCRM_CMD_TYPE_HANDSHAKE` (0x02) | ハンドシェイク | 本実装 |
| `SSCRM_CMD_TYPE_ROT_SET` (5) | 回転 | 未実装(必要ならソフトで回転) |
| `SSCRM_CMD_TYPE_SETTINGS` (6-7) | 設定 | 未実装 |
| `SSCRM_CMD_TYPE_BKL_SET` (8) | バックライト輝度 | **LY プロトコルには存在しない** — 純正 TRCC でも輝度はソフトディマー |
| `SSCRM_CMD_TYPE_LOGO` (9) | ロゴ表示 | 未実装 |

輝度に関しては [Lexonight1 プロジェクトのソース](https://github.com/Lexonight1/thermalright-trcc-linux/blob/main/src/trcc/core/commands/device.py)
に "Brightness is a software dimmer applied by the Renderer during composite;
the device protocol has no separate brightness command." と明記されています。
本実装で追加した [LCD Adjust](../README.md#lcd-adjust) スライダーも同じアプローチ
(canvas ctx.filter による中間トーン強調) を採用しています。

## テスト

本実装のワイヤーレイアウトが変わっていないことを保証する pytest スイートが
[`tests/test_protocol.py`](../tests/test_protocol.py) にあります。CI で
毎 push 走ります。

## 参考

- [Lexonight1/thermalright-trcc-linux](https://github.com/Lexonight1/thermalright-trcc-linux) — プロトコル解析元
- [doc/PROTOCOL_USBLCDNEW.md](https://github.com/Lexonight1/thermalright-trcc-linux/blob/main/doc/PROTOCOL_USBLCDNEW.md) — 上流の詳細プロトコル資料
- [trofeo/protocol.py](../trofeo/protocol.py) — 本実装
- [trofeo/device.py](../trofeo/device.py) — USB トランスポート層
