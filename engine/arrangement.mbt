// Instrument IDs are shared with the browser's diagnostic labels.
///|
const DRY_PIANO = 0

///|
const DEMO_KEYS = 1

///|
const CELESTA = 2

///|
const PULSE = 3

///|
const REED = 4

///|
const VIOLIN = 5

///|
const STRINGS = 6

///|
const PIZZ = 7

///|
const SLEIGH = 8

///|
const SOFT_KEYS = 9

///|
const BELL = 10

///|
const ARP = 11

///|
const TRIANGLE = 12

///|
const CHIP_KICK = 13

///|
const CHIP_NOISE = 14

///|
const JAZZ_KEYS = 15

///|
const UPRIGHT = 16

///|
const RIDE = 17

///|
const CELLO = 18

///|
const ENSEMBLE = 19

///|
const FLUTE = 20

///|
fn near_register(pitch : Int, target : Int) -> Int {
  pitch + round((target - pitch).to_double() / 12.0) * 12
}

///|
fn shaped_lead(
  melody : Array[Note],
  instrument : Int,
  style : Int,
  beats : Int,
  ticks : Int,
) -> Array[Note] {
  let result : Array[Note] = []
  let phrase = beats * TPQ * 4
  for i in 0..<melody.length() {
    let note = melody[i]
    let next = if i + 1 < melody.length() { melody[i + 1].start } else { ticks }
    let within_beat = note.start % TPQ
    let phase = note.start % phrase
    let swing = if style == 2 && (within_beat - TPQ / 2).abs() <= 80 {
      76
    } else {
      0
    }
    let start = Int::min(note.start + swing, Int::max(note.start, next - 1))
    let (duration, velocity) = match style {
      0 => (note.duration, if phase < TPQ * 2 { 104 } else { 94 })
      1 => (note.duration * 3 / 4, if within_beat < 65 { 108 } else { 90 })
      2 => (note.duration * 9 / 10, if swing > 0 { 102 } else { 87 })
      _ => {
        let midpoint = phrase / 2
        let swell = 18 - (phase - midpoint).abs() * 18 / midpoint
        (note.duration * 6 / 5, 77 + swell)
      }
    }
    result.push({
      ..note,
      start,
      duration: Int::max(1, Int::min(duration, next - start)),
      velocity,
      instrument,
    })
  }
  result
}

///|
fn arrange_notes(
  melody : Array[Note],
  chords : Array[Chord],
  beats : Int,
  style : Int,
  ticks : Int,
) -> Array[Note] {
  let lead = match style {
    0 => CELESTA
    1 => PULSE
    2 => REED
    _ => VIOLIN
  }
  let output = shaped_lead(melody, lead, style, beats, ticks)
  let mut upper = 72
  let beat = TPQ
  let bar_ticks = beats * beat
  for index in 0..<chords.length() {
    let chord = chords[index]
    let bar = chord.start
    let end = bar + chord.duration
    let bass = 36 + chord.root
    let root = 48 + chord.root
    let triad = [root, root + chord.third, root + chord.fifth]
    let phrase_bar = index % 4
    let top = near_register(root + chord.fifth, upper)
    upper = top.clamp(min=65, max=79)
    let add = fn(
      instrument : Int,
      pitch : Int,
      tick : Int,
      length : Int,
      velocity : Int,
    ) {
      let duration = Int::min(length, end - tick)
      if tick >= bar && duration >= 1 {
        output.push({
          pitch,
          start: tick,
          duration,
          velocity,
          confidence: 0.0,
          instrument,
        })
      }
    }
    match style {
      0 => {
        // A celesta-and-sleigh arrangement with a two-bar bell response.
        let third = near_register(root + chord.third, upper - 5)
        let sixth = near_register(
          root + (if chord.third == 3 { 10 } else { 9 }),
          upper - 2,
        )
        let strings = [near_register(root, 57), third, upper]
        for p in strings {
          add(
            STRINGS,
            p,
            bar,
            bar_ticks - 55,
            if phrase_bar >= 2 {
              57
            } else {
              44
            },
          )
        }
        if phrase_bar >= 2 {
          add(STRINGS, sixth, bar + beat, bar_ticks - beat - 50, 43)
        }
        add(PIZZ, bass, bar, beat + 150, 78)
        add(PIZZ, bass + chord.fifth, bar + beat + 240, beat / 2, 58)
        add(PIZZ, bass + 12, bar + beat * 2, beat + 190, 67)
        let next_root = if index + 1 < chords.length() {
          chords[index + 1].root
        } else {
          chord.root
        }
        add(PIZZ, near_register(35 + next_root, bass + 2), end - 230, 185, 53)
        for i in 0..<(beats * 2) {
          let tick = bar + i * beat / 2
          let accent = i % 2 == 0
          add(SLEIGH, 83, tick, 130, if accent { 88 } else { 51 })
          if accent {
            add(SLEIGH, 88, tick + 68, 90, 43)
          }
          if !accent {
            add(
              SOFT_KEYS,
              triad[(i + index) % 3] + 12,
              tick,
              192,
              if phrase_bar >= 2 {
                62
              } else {
                47
              },
            )
          }
        }
        for note in melody {
          if note.start >= bar &&
            note.start < end &&
            note.pitch <= 86 &&
            note.start % beat < 105 {
            add(
              BELL,
              note.pitch + 12,
              note.start,
              Int::min(note.duration, 245),
              if phrase_bar == 0 {
                66
              } else {
                52
              },
            )
          }
        }
        if phrase_bar % 2 == 1 {
          add(BELL, near_register(root + chord.third, 81), end - 440, 178, 58)
          add(BELL, near_register(root + chord.fifth, 85), end - 220, 178, 68)
        }
      }
      1 => {
        for i in 0..<16 {
          if phrase_bar == 3 && i >= beats * 4 - 2 {
            continue
          }
          let sequence = if phrase_bar % 2 == 0 { i % 3 } else { 2 - i % 3 }
          add(
            ARP,
            triad[sequence] + (if i % 4 == 3 { 24 } else { 12 }),
            bar + i * beat / 4,
            86,
            if i % 4 == 0 {
              72
            } else {
              45
            },
          )
        }
        let motion = [0, chord.fifth, 12, chord.fifth]
        for i in 0..<motion.length() {
          add(TRIANGLE, bass + motion[i], bar + i * beat, 370, 76)
        }
        for i in 0..<8 {
          if i % 2 == 0 {
            add(CHIP_KICK, 36 + i, bar + i * beat / 2, 110, 74)
          } else {
            add(CHIP_NOISE, 36 + i, bar + i * beat / 2, 110, 51)
          }
        }
      }
      2 => {
        let voicing = [
          near_register(root + chord.third, 60),
          near_register(root + chord.seventh, 66),
          near_register(root + chord.fifth, upper + 5),
        ]
        let comp = if phrase_bar % 2 == 0 {
          [320, 800, 1440]
        } else {
          [0, 800, 1760]
        }
        for i in 0..<comp.length() {
          for p in voicing {
            add(
              JAZZ_KEYS,
              p,
              bar + comp[i],
              if i == 1 {
                380
              } else {
                210
              },
              if i == 1 {
                54
              } else {
                65
              },
            )
          }
        }
        let following = if index + 1 < chords.length() {
          chords[index + 1].root
        } else {
          chord.root
        }
        let walking = [
          bass,
          bass + chord.third,
          bass + chord.fifth,
          35 + following,
        ]
        for i in 0..<walking.length() {
          add(UPRIGHT, walking[i], bar + i * beat, 407, 78)
        }
        for when in [0, 480, 800, 960, 1440, 1760] {
          add(RIDE, 51, bar + when, 125, if when % beat == 0 { 56 } else { 38 })
        }
      }
      _ => {
        add(
          CELLO,
          bass,
          bar,
          bar_ticks - 30,
          if phrase_bar == 3 {
            67
          } else {
            56
          },
        )
        add(
          ENSEMBLE,
          near_register(root + chord.third, 57),
          bar,
          bar_ticks - 25,
          45,
        )
        add(ENSEMBLE, upper, bar + beat / 2, bar_ticks - beat / 2 - 25, 47)
        let sequence = [0, 1, 2, 1, 0, 2, 1, 2]
        for i in 0..<sequence.length() {
          add(
            PIZZ,
            triad[sequence[i]],
            bar + i * beat / 2,
            170,
            if i % 2 == 0 {
              57
            } else {
              45
            },
          )
        }
        if phrase_bar == 1 || phrase_bar == 3 {
          add(
            FLUTE,
            near_register(root + chord.third, 75),
            bar + beat,
            beat + 230,
            49,
          )
          add(
            FLUTE,
            near_register(root + chord.fifth, 78),
            bar + beat * 5 / 2,
            beat,
            52,
          )
          if phrase_bar == 3 {
            add(FLUTE, near_register(root, 76), end - 230, 219, 46)
          }
        }
      }
    }
  }
  output
}
