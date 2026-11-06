# Music Style Compiler

音声から旋律を採譜し、Christmas、8-bit、Jazz、Classical に編曲するブラウザアプリ。各テーマの3色でヘッダーから曲目表まで塗り分け、曲・編曲・試聴を順に開けます。

## 起動

```sh
python3 -m http.server 8000 --directory dist
```

[localhost:8000](http://localhost:8000) を開き、スタイルと曲を選びます。出力は同じ位置でA/B試聴でき、WAV、MIDI、Music IRと処理時間を保存できます。

- **YouTube Music / YouTube** — 曲の共有URLを貼り付けると、対応する18の動画IDでは、同じ曲の収録音源またはWikimedia Commonsの別演奏ですぐに編曲します。YouTubeの演奏は別の公式プレーヤーで試聴できます。未登録のIDではメタデータから同じ曲の音源候補を提案できる場合があります。リンク先の録音で編曲する場合は、下記のPC版を利用します。
- **直接音声URL** — 利用可能な音声ファイルの直リンクを貼り付けます。HTTPS、CORS対応、リダイレクトなし、最大12 MiB。曲の登録は不要です。入力欄の「公開音源で試す」には [Keynata CommonsのCC0 J-POPインスト](https://carf-coder.github.io/keynata-commons/) の直リンクもあります。
- **Wikimedia Commons** — CC0またはパブリックドメインと表示される音声のファイルページを貼り付けます。
- **端末内の音声** — ファイル選択またはドロップで編曲します。最大32 MiB。ファイルはブラウザから送信されません。
- **収録曲** — 10曲の収録音源はアプリ内で合成します。個別URLは曲を選ぶとコピーできます。

音声ファイルは最大8分まで読み込み、選んだ開始位置から最長30秒を処理します。WAV、MP3、M4A、Ogg等はブラウザのデコード対応に依存します。外部音源の利用・編曲・出力の扱いは適用される利用条件に従ってください。

## YouTubeのリンク先の録音をPCで編曲する

Python 3.9以上とFFmpegが必要です。yt-dlpのYouTube対応にはJavaScriptランタイムも必要になるため、Node.js 22以上を利用できます。

```sh
git clone https://github.com/furukawa1020/Musicstylecompiler.git
cd Musicstylecompiler
python -m pip install -U "yt-dlp[default]"
python tools/youtube_studio.py
```

[PC版を開く](http://127.0.0.1:8765/) → スタイルを選ぶ → YouTubeまたはYouTube Musicの曲のURLを貼る。指定された録音の先頭から最長30秒を自動で編曲します。たとえば共有URLに `&t=90s` が含まれる場合は1:30から処理します。公開版の登録曲IDが入力されても、PC版はリンク先の録音を使います。

PC版の取得処理は起動したPCのループバックで実行します。ブラウザへ渡した録音はメモリで処理し、取得時の作業ファイルは処理終了時に消去します。視聴制限や取得元の制限によって処理できないリンクがあります。録音の取得・編曲が許可されている音源で利用してください。GitHub PagesはPC版の取得処理を実行できません。

## 変換の範囲

Web Workerが支配的な旋律とテンポを推定し、Music IRを作成します。音声ファイルは4/4を仮定します。旋律と調性に合う和音を選び、採譜結果の音程を保持し、スタイルごとにタイミング、音の長さ、強弱、伴奏を組み直します。Christmasは12/8または9/8の3連の拍、8-bitは同時発音を制限した4チャンネル、Jazzはスウィングと条件付きの経過和音、Classicalは3/4拍子と対旋律で組みます。複雑なミックスの精密な採譜や歌声の再現は対象外です。自動採譜できないときは、旋律が聞き取りやすい区間からやり直せます。

## MoonBitエンジン

採譜、音声からの拍とピッチクラスの分析、編曲、合成、WAV / MIDI出力をMoonBitで実装しています。ブラウザ側は音声デコード、DOM操作、WorkerとWasm間のデータ転送を担当します。Wasmは最初の編曲時にロードします。

MoonBitの `wasm` ターゲットを使って `sh engine/build.sh` で `dist/music-compiler.wasm` を再生成できます。配信は同梱済みのバイナリを使います。ビルド確認は moon 0.1.20260920 / moonc 0.10.14 で実施しました。

## 検証とGitHub Pages

Node.js 22以上で `node --test` を実行します。収録音源、ライブラリ外のPCM、旋律保持、WAV・MIDI、URL分岐と音声の切り出しを確認します。

[GitHub Pages](https://furukawa1020.github.io/Musicstylecompiler/) は既存の `main` ルート公開を使います。ルートから静的アプリの `dist/` に移動します。Pagesの公開元を将来GitHub Actionsへ変更する場合は、`Publish GitHub Pages` ワークフローで `dist/` だけを公開できます。

[設計・音源・参考資料](docs/decisions/browser-compiler.md)
