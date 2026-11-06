// The non-GC Wasm backend passes these borrowed arrays as linear memory
// addresses. Globals retain the buffers until the next call replaces them.

///|
#borrow(buffer)
extern "wasm" fn float_address(buffer : FixedArray[Float]) -> Int = "(func (param i32) (result i32) local.get 0)"

///|
#borrow(buffer)
extern "wasm" fn byte_address(buffer : FixedArray[Byte]) -> Int = "(func (param i32) (result i32) local.get 0)"

///|
priv struct State {
  mut pcm : FixedArray[Float]
  mut output : FixedArray[Byte]
  mut sample_count : Int
  mut channels : Int
  mut rate : Int
  mut duration : Double
  mut frames : Array[Frame]
  mut hop : Double
  mut emphasis : Bool
  mut melody : Array[Note]
  mut arranged : Array[Note]
  mut demo : Array[Note]
  mut chords : Array[Chord]
  mut bpm : Int
  mut tempo_confidence : Double
  mut root : Int
  mut minor : Bool
  mut key_confidence : Double
  mut voiced : Double
  mut beats : Int
  mut ticks : Int
  mut style : Int
  mut groove : Groove
  mut harmony : Array[Chord]
}

///|
let state : State = {
  pcm: [],
  output: [],
  sample_count: 0,
  channels: 0,
  rate: RENDER_RATE,
  duration: 0.0,
  frames: [],
  hop: 0.0,
  emphasis: false,
  melody: [],
  arranged: [],
  demo: [],
  chords: [],
  bpm: 108,
  tempo_confidence: 0.0,
  root: 0,
  minor: false,
  key_confidence: 0.0,
  voiced: 0.0,
  beats: 4,
  ticks: 0,
  style: 0,
  groove: groove_for(0, 4, 108),
  harmony: [],
}

///|
pub fn prepare_input(frames : Int, channels : Int, rate : Int) -> Int {
  if channels < 1 ||
    channels > 2 ||
    rate < 8000 ||
    rate > 96000 ||
    frames <= 0 ||
    frames > rate * 30 {
    return 0
  }
  state.sample_count = frames
  state.channels = channels
  state.rate = rate
  state.duration = frames.to_double() / rate.to_double()
  state.pcm = FixedArray::make(frames * channels, 0.0F)
  float_address(state.pcm)
}

///|
pub fn add_demo_note(
  pitch : Int,
  start : Int,
  duration : Int,
  velocity : Int,
  instrument : Int,
) -> Unit {
  state.demo.push({
    pitch,
    start,
    duration,
    velocity,
    confidence: 1.0,
    instrument,
  })
}

///|
pub fn render_demo(duration : Double, bpm : Int) -> Int {
  let frames = @math.ceil(duration * RENDER_RATE.to_double()).to_int()
  let (pcm, peak) = synthesize(state.demo, bpm.to_double(), frames, false)
  state.demo = []
  state.pcm = pcm
  state.sample_count = frames
  state.channels = 2
  state.rate = RENDER_RATE
  state.duration = duration
  if peak < 0.002 {
    0
  } else {
    1
  }
}

///|
fn lead_frames(frames : Array[Frame]) -> Int {
  let mut count = 0
  for frame in frames {
    if frame.pitch >= 56 {
      count += 1
    }
  }
  count
}

///|
pub fn analyze(is_demo : Int) -> Int {
  let (frames, hop, peak) = frames_for(
    state.pcm,
    state.sample_count,
    state.channels,
    state.rate,
    false,
  )
  if peak < 0.001 {
    return 0
  }
  state.frames = frames
  state.hop = hop
  state.emphasis = false
  if is_demo == 0 {
    let raw_count = lead_frames(frames)
    if raw_count.to_double() < frames.length().to_double() * 0.32 {
      let (filtered, _, _) = frames_for(
        state.pcm,
        state.sample_count,
        state.channels,
        state.rate,
        true,
      )
      if lead_frames(filtered).to_double() > raw_count.to_double() * 1.16 {
        state.frames = filtered
        state.emphasis = true
      }
    }
  }
  1
}

///|
pub fn transcribe(beats : Int) -> Int {
  let segments = notes_from_frames(state.frames, state.hop)
  state.frames = []
  let mut voiced = 0.0
  for segment in segments {
    voiced += segment.duration
  }
  state.voiced = voiced / state.duration
  if segments.length() < 4 || state.voiced < 0.16 {
    return 0
  }
  let (note_bpm, note_confidence) = estimate_tempo(segments)
  let mut bpm = note_bpm
  let mut tempo_confidence = note_confidence
  if beats == 0 && tempo_confidence <= 0.55 {
    let (pulse, confidence) = estimate_pulse(
      state.pcm,
      state.sample_count,
      state.channels,
      state.rate,
    )
    if confidence >= 0.15 {
      bpm = pulse
      tempo_confidence = confidence
    }
  }
  state.bpm = bpm
  state.tempo_confidence = tempo_confidence
  let to_tick = fn(time : Double) {
    round(time * TPQ.to_double() * bpm.to_double() / 60.0)
  }
  state.ticks = Int::max(1, to_tick(state.duration))
  state.melody = segments.map(fn(note) {
    let start = to_tick(note.start)
    {
      pitch: note.pitch,
      start,
      duration: Int::min(
        Int::max(1, to_tick(note.duration)),
        state.ticks - start,
      ),
      velocity: 93,
      confidence: round(note.confidence * 1000.0).to_double() / 1000.0,
      instrument: -1,
    }
  })
  let (root, minor, key_confidence) = estimate_key(state.melody)
  state.root = root
  state.minor = minor
  state.key_confidence = key_confidence
  state.beats = if beats == 3 { 3 } else { 4 }
  let bar = state.beats * TPQ
  let chroma = if beats == 0 {
    audio_chroma(
      state.pcm,
      state.sample_count,
      state.channels,
      state.rate,
      bpm,
      state.beats,
      (state.ticks + bar - 1) / bar,
    )
  } else {
    []
  }
  state.chords = infer_chords(
    state.melody,
    root,
    minor,
    state.ticks,
    bar,
    chroma,
  )
  1
}

///|
pub fn arrange(style : Int) -> Unit {
  state.style = style
  let groove = groove_for(style, state.beats, state.bpm)
  state.groove = groove
  let lead = shaped_lead(
    state.melody,
    groove,
    style,
    map_tick(state.ticks, groove),
  )
  state.harmony = arranged_harmony(state.chords, lead, groove, style)
  state.arranged = arrange_notes(lead, state.harmony, groove, style)
}

///|
pub fn render() -> Int {
  let frames = @math.ceil(state.duration * RENDER_RATE.to_double()).to_int()
  let (pcm, peak) = synthesize(
    state.arranged,
    state.groove.bpm,
    frames,
    state.style != 1,
  )
  if peak < 0.002 {
    return 0
  }
  state.output = wav(pcm, frames, 2, RENDER_RATE)
  byte_address(state.output)
}

///|
pub fn render_original() -> Int {
  state.output = wav(state.pcm, state.sample_count, state.channels, state.rate)
  state.pcm = []
  byte_address(state.output)
}

///|
pub fn export_midi() -> Int {
  state.output = midi(state.arranged, state.groove)
  byte_address(state.output)
}

///|
pub fn output_size() -> Int {
  state.output.length()
}

///|
pub fn info(field : Int) -> Double {
  match field {
    0 => state.duration
    1 => state.ticks.to_double()
    2 => state.bpm.to_double()
    3 => state.tempo_confidence
    4 => state.beats.to_double()
    5 => state.root.to_double()
    6 => if state.minor { 1.0 } else { 0.0 }
    7 => state.key_confidence
    8 => if state.emphasis { 1.0 } else { 0.0 }
    9 => state.voiced
    10 => state.groove.bpm
    11 => state.groove.numerator.to_double()
    12 => state.groove.denominator.to_double()
    _ => map_tick(state.ticks, state.groove).to_double()
  }
}

///|
pub fn note_count(arranged : Int) -> Int {
  if arranged == 1 {
    state.arranged.length()
  } else {
    state.melody.length()
  }
}

///|
pub fn note_field(arranged : Int, index : Int, field : Int) -> Double {
  let note = if arranged == 1 {
    state.arranged[index]
  } else {
    state.melody[index]
  }
  match field {
    0 => note.pitch.to_double()
    1 => note.start.to_double()
    2 => note.duration.to_double()
    3 => note.velocity.to_double()
    4 => note.confidence
    _ => note.instrument.to_double()
  }
}

///|
pub fn chord_count(arranged : Int) -> Int {
  if arranged == 1 {
    state.harmony.length()
  } else {
    state.chords.length()
  }
}

///|
pub fn chord_field(arranged : Int, index : Int, field : Int) -> Double {
  let chord = if arranged == 1 {
    state.harmony[index]
  } else {
    state.chords[index]
  }
  match field {
    0 => chord.root.to_double()
    1 => chord.third.to_double()
    2 => chord.fifth.to_double()
    3 => chord.seventh.to_double()
    4 => chord.start.to_double()
    5 => chord.duration.to_double()
    _ => chord.confidence
  }
}
