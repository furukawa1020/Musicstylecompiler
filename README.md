# Music Style Compiler

音声から旋律を採譜し、Christmas、8-bit、Jazz、Classical に編曲するブラウザアプリ。各テーマの3色でヘッダーから曲目表まで塗り分けます。

## 起動

```sh
python3 -m http.server 8000 --directory dist
```

[localhost:8000](http://localhost:8000) を開き、スタイルと曲を選びます。出力は同じ位置でA/B試聴でき、WAV、MIDI、Music IRと処理時間を保存できます。

- **YouTube Music / YouTube** — 曲の共有URLを貼り付けると、対応する動画IDでは同じ曲の収録音源を使ってすぐに編曲します。YouTubeの演奏は別の公式プレーヤーで試聴できます。未登録のIDではメタデータから同名の収録曲を提案できる場合があります。任意のYouTube音声の抽出・加工は行いません。
- **直接音声URL** — 利用可能な音声ファイルの直リンクを貼り付けます。HTTPS、CORS対応、リダイレクトなし、最大12 MiB。曲の登録は不要です。入力欄の「公開音源で試す」には [Keynata CommonsのCC0 J-POPインスト](https://carf-coder.github.io/keynata-commons/) の直リンクもあります。
- **Wikimedia Commons** — CC0またはパブリックドメインと表示される音声のファイルページを貼り付けます。
- **端末内の音声** — ファイル選択またはドロップで編曲します。最大32 MiB。ファイルはブラウザから送信されません。
- **収録曲** — 10曲の収録音源はアプリ内で合成します。個別URLは曲を選ぶとコピーできます。

音声ファイルは最大8分まで読み込み、選んだ開始位置から最長30秒を処理します。WAV、MP3、M4A、Ogg等はブラウザのデコード対応に依存します。外部音源の利用・編曲・出力の扱いは適用される利用条件に従ってください。

## 変換の範囲

Web Workerが支配的な旋律とテンポを推定し、Music IRを作成します。音声ファイルは4/4を仮定します。旋律と調性に合う和音を選び、採譜結果の音程・開始・長さを保持して別の楽器と伴奏を合成します。複雑なミックスの精密な採譜や歌声の再現は対象外です。自動採譜できないときは、旋律が聞き取りやすい区間からやり直せます。

## 検証とGitHub Pages

Node.js 22以上で `node --test` を実行します。収録音源、ライブラリ外のPCM、旋律保持、WAV・MIDI、URL分岐と音声の切り出しを確認します。

[GitHub Pages](https://furukawa1020.github.io/Musicstylecompiler/) は既存の `main` ルート公開を使います。ルートから静的アプリの `dist/` に移動します。Pagesの公開元を将来GitHub Actionsへ変更する場合は、`Publish GitHub Pages` ワークフローで `dist/` だけを公開できます。

[設計・音源・参考資料](docs/decisions/browser-compiler.md)
