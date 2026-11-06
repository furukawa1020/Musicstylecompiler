# ブラウザ内コンパイラの初版

初版では静的配布とブラウザ内処理を採用した。GPUや外部サービスの資格情報なしで入力から試聴まで試せ、音声をサーバーへ保存する必要がない。Web Workerは解析、採譜、編曲、合成の開始を実処理に合わせて通知し、中止時はワーカーと通信を停止する。

音声を短いフレームに分け、正規化自己相関で支配的な基本周波数を推定する。連続する同音をまとめて旋律を作り、音の間隔からBPM、ピッチクラス分布から調性を推定する。Music IR v0.1 のテンポは一定、拍子は4/4、区間はクリップ全体。和音は旋律に適合する候補から選んだ伴奏用の提案であり、原曲のコード推定とは区別する。スタイルパスは旋律のノート列を複製し、楽器と伴奏トラックを割り当てる。内蔵シンセでステレオWAVを合成し、同じ編曲をGM近似のMIDIで出力する。

「冬のポストカード」「紙ひこうき」は本アプリ向けに作成したオリジナル旋律・合成音源で、旋律と付属デモ録音をCC0 1.0で提供する。デモの入力には音声へ合成したPCMだけを解析器へ渡す。編曲処理からデモの正解ノート列やBPMを参照しない。

YouTubeは[公式埋め込み](https://developers.google.com/youtube/iframe_api_reference)を使用し、[APIのデベロッパーポリシー](https://developers.google.com/youtube/terms/developer-policies)に従って音声を抽出しない。直接音声の取得は、利用者が入力したURLにブラウザから認証情報なし・リダイレクトなしで行う。URLや端末のファイル名が成果物に残らないよう、Music IRには入力方式と開始位置を保存する。

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

## 選曲と4テーマ

収録曲をオリジナル2曲と、歴史的な楽曲・伝承旋律8曲に増やした。内蔵録音はパブリックドメインの旋律を基にアプリ内で合成し、スタジオ録音はCC0とする。短い抜粋や移調がある。YouTubeの動画IDは楽曲への参照だけを保持する。異なる録音を同一音源として扱わず、結果には収録音源を使ったことを表示する。未登録の動画のタイトルは候補提示だけに使う。直接URLと端末ファイルは同じPCMコンパイラへ入力し、開始位置は利用者が変更できる。ライブラリ外の音源は必要に応じて旋律域を強調して解析する。Wikimedia Commonsのファイルページは公開APIで元ファイルと収録音声のライセンスを確認し、CC0またはパブリックドメインの音声だけを取り込む。

| テーマ | 参照した実物と設計への反映 |
| --- | --- |
| Christmas | [Cooper Hewittの1957年のクリスマスカード](https://www.si.edu/object/christmas-card:chndm_1959-11-1-a)。深緑の版面、赤い差し色、金色の装飾を切手風の自作イラストと紙面に展開。 |
| 8-bit | [Game Boy版 Tetrisの画面](https://www.mobygames.com/game/42121/tetris/screenshots/gameboy/15851/)。液晶の限られた階調、ピクセルの矩形、一覧のカーソルを採用。 |
| Jazz | [MoMA所蔵のReid MilesによるBlue Noteのジャケット](https://www.moma.org/collection/works/185422)。強い文字組み、限られたインク色、斜めに走る反復図形を別の構図で使用。 |
| Classical | [London Philharmonic Orchestraの演奏会プログラム](https://lpo.org.uk/your-visit/concert-programmes/)。上部の演奏会名と横罫で整理した曲目、本文と演目の書体差を採用。 |

[ジングルベルの歴史的譜面](https://www.loc.gov/item/2023838067/) · [ベートーヴェン《交響曲第九番》](https://imslp.org/wiki/Symphony_No.9,_Op.125_(Beethoven,_Ludwig_van)) · [モーツァルト《ああ、お母さん聞いて》変奏曲](https://imslp.org/wiki/Ah!_vous_dirai-je,_maman_(Mozart,_Wolfgang_Amadeus))

YouTubeの登録例は[ジングルベル](https://www.youtube.com/watch?v=4b7dFqv94iI)、[歓喜の歌](https://www.youtube.com/watch?v=nl3-k5GfYlw)、[きらきら星](https://www.youtube.com/watch?v=uzu-pSlOS8w)。これらの録音を取り込まず、同一楽曲の収録音源を入力に使用する。
