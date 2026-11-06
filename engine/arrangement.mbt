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
priv struct Groove {
  bpm : Double
  numerator : Int
  denominator : Int
  unit : Int
  beats : Int
  from_bar : Int
  to_bar : Int
}

///|
fn groove_for(style : Int, source_beats : Int, bpm : Int) -> Groove {
  let beats = if style == 3 { 3 } else { source_beats }
  let unit = if style == 0 { TPQ * 3 / 2 } else { TPQ }
  let from_bar = source_beats * TPQ
  let to_bar = beats * unit
  {
    bpm: bpm.to_double() * to_bar.to_double() / from_bar.to_double(),
    numerator: if style == 0 {
      beats * 3
    } else {
      beats
    },
    denominator: if style == 0 {
      8
    } else {
      4
    },
    unit,
    beats,
    from_bar,
    to_bar,
  }
}

///|
fn map_tick(tick : Int, groove : Groove) -> Int {
  (tick * groove.to_bar + groove.from_bar / 2) / groove.from_bar
}

///|
fn lead_tick(tick : Int, groove : Groove, style : Int) -> Int {
  let mapped = map_tick(tick, groove)
  let beat = mapped / groove.unit
  let phase = mapped % groove.unit
  // Piecewise interpolation keeps note order while shifting the offbeat.
  let offbeat = match style {
    0 => TPQ
    2 => TPQ * 2 / 3
    _ => groove.unit / 2
  }
  let midpoint = groove.unit / 2
  beat * groove.unit +
  (if phase <= midpoint {
    phase * offbeat / midpoint
  } else {
    offbeat + (phase - midpoint) * (groove.unit - offbeat) / midpoint
  })
}

///|
fn shaped_lead(
  melody : Array[Note],
  groove : Groove,
  style : Int,
  ticks : Int,
) -> Array[Note] {
  let instrument = match style {
    0 => CELESTA
    1 => PULSE
    2 => REED
    _ => VIOLIN
  }
  let result : Array[Note] = []
  let phrase = groove.to_bar * 4
  let mut start = Int::min(
    lead_tick(melody[0].start, groove, style),
    ticks - melody.length(),
  )
  for i in 0..<melody.length() {
    let note = melody[i]
    let next = if i + 1 < melody.length() {
      lead_tick(melody[i + 1].start, groove, style).clamp(
        min=start + 1,
        max=ticks - (melody.length() - i - 1),
      )
    } else {
      ticks
    }
    let length = lead_tick(note.start + note.duration, groove, style) - start
    let accented = start % groove.unit < groove.unit / 7
    let phase = start % phrase
    let (duration, velocity) = match style {
      0 => (length * 9 / 10, if accented { 107 } else { 87 })
      1 => (length * 2 / 3, if accented { 110 } else { 86 })
      2 => (length * 9 / 10, if accented { 90 } else { 104 })
      _ => {
        let midpoint = phrase / 2
        let swell = 20 - (phase - midpoint).abs() * 20 / midpoint
        (length * 5 / 4, 77 + swell)
      }
    }
    result.push({
      ..note,
      start,
      duration: Int::max(1, Int::min(duration, next - start)),
      velocity,
      instrument,
    })
    start = next
  }
  result
}

///|
fn chord_pitch(chord : Chord, pitch : Int) -> Bool {
  let relative = (pitch - chord.root + 12) % 12
  relative == 0 ||
  relative == chord.third ||
  relative == chord.fifth ||
  relative == chord.seventh
}

///|
fn arranged_harmony(
  chords : Array[Chord],
  melody : Array[Note],
  groove : Groove,
  style : Int,
) -> Array[Chord] {
  let result : Array[Chord] = []
  for index in 0..<chords.length() {
    let source = chords[index]
    let start = map_tick(source.start, groove)
    let end = map_tick(source.start + source.duration, groove)
    let seventh = if style == 2 { source.seventh } else { -1 }
    let chord = { ..source, start, duration: end - start, seventh, }
    let jazz_cadence = style == 2 && index % 2 == 1
    let carol_cadence = style == 0 && index % 4 == 3
    if (jazz_cadence || carol_cadence) &&
      index + 1 < chords.length() &&
      chord.duration == groove.to_bar {
      let following = chords[index + 1]
      let length = if jazz_cadence { groove.unit / 3 } else { groove.unit }
      let pickup = end - length
      let approach = {
        root: (following.root + (if jazz_cadence { 7 } else { 5 })) % 12,
        third: if carol_cadence && following.third == 3 {
          3
        } else {
          4
        },
        fifth: 7,
        seventh: if jazz_cadence {
          10
        } else {
          -1
        },
        start: pickup,
        duration: length,
        confidence: 0.0,
      }
      // Preserve the harmony where a sustained melody tone clashes with the pickup.
      let conflict = melody.any(fn(note) {
        let overlap = Int::min(end, note.start + note.duration) -
          Int::max(pickup, note.start)
        overlap >= length / 3 && !chord_pitch(approach, note.pitch)
      })
      if !conflict && approach.root != chord.root {
        result.push({ ..chord, duration: pickup - start, })
        result.push(approach)
        continue
      }
    }
    result.push(chord)
  }
  result
}

///|
type AddNote = (Int, Int, Int, Int, Int) -> Unit

///|
fn christmas_bar(
  chord : Chord,
  following : Chord,
  lead : Array[Note],
  groove : Groove,
  index : Int,
  add : AddNote,
) -> Unit {
  let start = chord.start
  let end = start + chord.duration
  let beat = groove.unit
  let root = 48 + chord.root
  let bass = 36 + chord.root
  let third = near_register(root + chord.third, 64)
  let fifth = near_register(root + chord.fifth, 69)
  let full = index % 8 >= 4
  for pitch in [near_register(root, 57), third, fifth] {
    add(STRINGS, pitch, start, chord.duration - 45, if full { 59 } else { 39 })
  }
  if full && chord.third == 4 {
    add(
      STRINGS,
      near_register(root + 9, 76),
      start + beat,
      chord.duration - beat - 45,
      46,
    )
  }
  for i in 0..<groove.beats {
    let at = start + i * beat
    let down = i % 2 == 0
    add(
      PIZZ,
      if down {
        bass
      } else {
        bass + chord.fifth
      },
      at,
      beat * 3 / 5,
      if down {
        84
      } else {
        59
      },
    )
    add(
      SLEIGH,
      if down {
        82
      } else {
        85
      },
      at,
      160,
      if down {
        102
      } else {
        69
      },
    )
    add(SLEIGH, 87, at + beat / 3, 110, if full { 69 } else { 46 })
    add(SLEIGH, 91, at + beat * 2 / 3, 140, if full { 85 } else { 66 })
    if full || !down {
      add(
        SOFT_KEYS,
        if down {
          third + 12
        } else {
          fifth + 12
        },
        at + beat * 2 / 3,
        180,
        if full {
          57
        } else {
          43
        },
      )
    }
  }
  let pickup = start + groove.to_bar - beat / 3
  if chord.duration == groove.to_bar && following.root != chord.root {
    let next = near_register(36 + following.root, bass)
    add(PIZZ, next + (if next > bass { -2 } else { 2 }), pickup, beat / 4, 68)
  }
  // The bells answer only between accented melody notes, then ring together at cadences.
  for note in lead {
    if note.start >= start &&
      note.start < end &&
      note.pitch <= 90 &&
      (note.start - start) % (beat * 2) < beat / 6 {
      add(
        BELL,
        note.pitch + 12,
        note.start,
        beat / 2,
        if full {
          76
        } else {
          61
        },
      )
    }
  }
  if index % 2 == 1 {
    let response = start + groove.to_bar - beat
    let busy = lead.any(fn(note) {
      note.start > response && note.start < end && note.duration > beat / 4
    })
    if !busy {
      add(BELL, third + 12, response + beat / 3, beat / 2, 64)
      add(BELL, fifth + 12, response + beat * 2 / 3, beat / 3, 75)
    }
  }
  if index % 4 == 3 {
    add(BELL, near_register(root, 78), start, beat, 74)
  }
}

///|
fn chip_bar(
  chord : Chord,
  following : Chord,
  groove : Groove,
  index : Int,
  add : AddNote,
) -> Unit {
  let start = chord.start
  let root = 48 + chord.root
  let bass = 36 + chord.root
  let triad = [root + 12, root + chord.third + 12, root + chord.fifth + 12]
  let beat = groove.unit
  let fill = index % 4 == 3
  let breakdown = index % 8 == 4
  for i in 0..<(groove.beats * 4) {
    let at = start + i * beat / 4
    let phase = i % 4
    if !breakdown || phase == 0 {
      let position = if index % 2 == 0 { i % 3 } else { 2 - i % 3 }
      let octave = if phase == 3 { 12 } else { 0 }
      add(
        ARP,
        triad[position] + octave,
        at,
        78,
        if phase == 0 {
          77
        } else {
          51
        },
      )
    }
    if phase == 0 {
      let pitch = if i == 0 { bass } else { bass + chord.fifth }
      add(TRIANGLE, pitch, at, if breakdown { 394 } else { 210 }, 82)
      if !breakdown {
        add(CHIP_KICK, 36, at, 76, 77)
      }
    } else if phase == 2 {
      if !breakdown {
        let pitch = if fill && i >= groove.beats * 4 - 2 {
          near_register(36 + following.root, bass) - 1
        } else {
          bass + 12
        }
        add(TRIANGLE, pitch, at, 175, 66)
      }
      add(CHIP_NOISE, 42, at, 66, if i % 8 == 6 { 67 } else { 42 })
    } else if fill && i >= groove.beats * 4 - 4 {
      add(CHIP_NOISE, 42, at, 62, 62)
    }
  }
}

///|
fn jazz_bar(
  chord : Chord,
  following : Chord,
  groove : Groove,
  index : Int,
  upper : Int,
  add : AddNote,
) -> Int {
  let start = chord.start
  let root = 48 + chord.root
  let bass = 36 + chord.root
  let beat = groove.unit
  let sync = beat * 2 / 3
  let third = near_register(root + chord.third, 61)
  let seventh = near_register(root + chord.seventh, 66)
  let color = if chord.third == 3 { 14 } else { 21 }
  let top = near_register(root + color, upper.clamp(min=71, max=78))
  let pickup = start % groove.to_bar != 0
  let comp = if pickup {
    [0]
  } else if index % 2 == 0 {
    [sync, beat + sync, beat * (groove.beats - 1)]
  } else {
    [0, beat + sync, beat * (groove.beats - 1) + sync]
  }
  for i in 0..<comp.length() {
    for pitch in [third, seventh, top] {
      add(
        JAZZ_KEYS,
        pitch,
        start + comp[i],
        if i % 2 == 0 {
          166
        } else {
          305
        },
        if i == 0 {
          70
        } else {
          54
        },
      )
    }
  }
  let next_bass = near_register(36 + following.root, bass + 2)
  let third_bass = near_register(bass + chord.third, bass + 2)
  let fifth_bass = near_register(bass + chord.fifth, bass + 3)
  let beats = (chord.duration + beat - 1) / beat
  for i in 0..<beats {
    let pitch = if i == 0 {
      bass
    } else if i == beats - 1 {
      next_bass + (if next_bass > fifth_bass { -1 } else { 1 })
    } else if i == 1 {
      third_bass
    } else {
      fifth_bass
    }
    let tick = start + i * beat
    add(UPRIGHT, pitch, tick, beat * 9 / 10, if i % 2 == 0 { 83 } else { 73 })
    add(
      RIDE,
      51,
      tick,
      135,
      if tick % groove.to_bar / beat % 2 == 1 {
        73
      } else {
        48
      },
    )
    if tick % groove.to_bar / beat % 2 == 1 {
      add(RIDE, 51, tick + sync, 105, 46)
    }
  }
  top
}

///|
fn classical_bar(
  chord : Chord,
  following : Chord,
  lead : Array[Note],
  groove : Groove,
  index : Int,
  upper : Int,
  add : AddNote,
) -> Int {
  let start = chord.start
  let root = 48 + chord.root
  let beat = groove.unit
  let bass = near_register(36 + chord.root, 44)
  let third = near_register(root + chord.third, 57)
  let fifth = near_register(root + chord.fifth, 63)
  let climax = index % 8 >= 4 && index % 8 < 7
  let cadence = index % 4 == 3
  add(
    CELLO,
    bass,
    start,
    if cadence {
      chord.duration
    } else {
      beat * 2 - 30
    },
    if climax {
      78
    } else {
      63
    },
  )
  if !cadence {
    add(
      CELLO,
      near_register(36 + following.root + chord.fifth, bass + 2),
      start + beat * 2,
      beat - 35,
      58,
    )
  }
  add(
    ENSEMBLE,
    third,
    start + beat,
    beat * 2 - 32,
    if climax {
      69
    } else {
      49
    },
  )
  add(
    ENSEMBLE,
    fifth,
    start + beat * 2,
    beat - 30,
    if climax {
      65
    } else {
      47
    },
  )
  if !climax {
    add(PIZZ, bass + 12, start, 230, 61)
    add(PIZZ, third, start + beat, 190, 48)
    add(PIZZ, fifth, start + beat * 2, 150, 45)
  }
  let active = lead.filter(fn(note) {
    note.start >= start && note.start < start + chord.duration
  })
  let falling = active.length() > 1 &&
    active[0].pitch > active[active.length() - 1].pitch
  let direction = if falling { 1 } else { -1 }
  let target = near_register(
    root + chord.third,
    (upper + direction * 3).clamp(min=68, max=82),
  )
  if climax || cadence {
    add(
      FLUTE,
      target,
      start + beat / 2,
      beat * 3 / 2 - 25,
      if climax {
        62
      } else {
        49
      },
    )
    let answer = if cadence { root } else { root + chord.fifth }
    add(
      FLUTE,
      near_register(answer, target + direction * 3),
      start + beat * 2,
      beat - 30,
      57,
    )
  }
  target
}

///|
fn arrange_notes(
  lead : Array[Note],
  chords : Array[Chord],
  groove : Groove,
  style : Int,
) -> Array[Note] {
  let output = lead.copy()
  let mut upper = 72
  for index in 0..<chords.length() {
    let chord = chords[index]
    let next = if index + 1 < chords.length() {
      chords[index + 1]
    } else {
      chord
    }
    let end = chord.start + chord.duration
    let bar = chord.start / groove.to_bar
    let add = fn(
      instrument : Int,
      pitch : Int,
      tick : Int,
      length : Int,
      velocity : Int,
    ) {
      let duration = Int::min(length, end - tick)
      if tick >= chord.start && duration > 0 {
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
      0 => christmas_bar(chord, next, lead, groove, bar, add)
      1 => chip_bar(chord, next, groove, bar, add)
      2 => upper = jazz_bar(chord, next, groove, bar, upper, add)
      _ => upper = classical_bar(chord, next, lead, groove, bar, upper, add)
    }
  }
  output
}
