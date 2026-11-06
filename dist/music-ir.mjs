export const TPQ = 480;
export const MAX_SECONDS = 30;
export const STYLES = {
  christmas: { id: 0, label: 'Christmas', lead: 'celesta', passes: ['3連の拍子に組み替え', '3連のスレイベルと跳ねる低音', '旋律に答えるハンドベル', '4小節ごとの弦とプラガル進行'] },
  chip: { id: 1, label: '8-bit', lead: 'pulse', passes: ['単音パルス2声', '三角波ベース', '高速アルペジオとブレイク', '単音打楽器のフィル'] },
  jazz: { id: 2, label: 'Jazz', lead: 'reed', passes: ['スウィング比2対1', '条件付きのセカンダリードミナント', 'ガイドトーンとテンション', '半音でつなぐウォーキングベース'] },
  classical: { id: 3, label: 'Classical', lead: 'violin', passes: ['3/4拍子に組み替え', 'レガートと4小節の強弱', '旋律に逆行する木管', 'チェロ・内声のワルツ伴奏'] },
};
export function validate(ir) {
  if (!Number.isInteger(ir.total_ticks) || ir.total_ticks < 1 || !Number.isFinite(ir.duration_sec)
      || ir.duration_sec <= 0 || !Number.isFinite(ir.tempo_map[0]?.bpm) || ir.tempo_map[0].bpm <= 0
      || !Number.isInteger(ir.ticks_per_quarter) || ir.ticks_per_quarter <= 0) throw new Error('Music IR の曲長またはテンポが不正です。');
  if (new Set(ir.tracks.map(track => track.id)).size !== ir.tracks.length) throw new Error('Music IR のトラックIDが重複しています。');
  for (const section of ir.sections) {
    if (section.start_tick < 0 || section.end_tick > ir.total_ticks || section.end_tick <= section.start_tick) throw new Error('Music IR の区間が不正です。');
  }
  for (const track of ir.tracks) {
    for (const note of track.notes) {
      if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127
          || !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127
          || !Number.isInteger(note.start_tick) || note.start_tick < 0
          || !Number.isInteger(note.duration_ticks) || note.duration_ticks < 1
          || note.start_tick + note.duration_ticks > ir.total_ticks) throw new Error('Music IR のノート範囲が不正です。');
    }
  }
}
