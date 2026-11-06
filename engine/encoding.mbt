///|
fn wav(
  samples : FixedArray[Float],
  frames : Int,
  channels : Int,
  rate : Int,
) -> FixedArray[Byte] {
  let size = frames * channels * 2
  let result = FixedArray::make(44 + size, b'\x00')
  let header = [
    b'R', b'I', b'F', b'F', b'\x00', b'\x00', b'\x00', b'\x00', b'W', b'A', b'V',
    b'E', b'f', b'm', b't', b' ', b'\x10', b'\x00', b'\x00', b'\x00', b'\x01', b'\x00',
    b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00',
    b'\x00', b'\x00', b'\x00', b'\x10', b'\x00', b'd', b'a', b't', b'a',
  ]
  for i in 0..<header.length() {
    result[i] = header[i]
  }
  let le32 = fn(offset : Int, value : Int) {
    for i in 0..<4 {
      result[offset + i] = (value >> (8 * i)).to_byte()
    }
  }
  le32(4, 36 + size)
  result[22] = channels.to_byte()
  le32(24, rate)
  le32(28, rate * channels * 2)
  result[32] = (channels * 2).to_byte()
  le32(40, size)
  for i in 0..<frames {
    for ch in 0..<channels {
      let value = samples
        .unsafe_get(i + ch * frames)
        .to_double()
        .clamp(min=-1.0, max=1.0)
      let n = round(value * 32767.0)
      let offset = 44 + (i * channels + ch) * 2
      result.unsafe_set(offset, n.to_byte())
      result.unsafe_set(offset + 1, (n >> 8).to_byte())
    }
  }
  result
}

///|
let midi_program : FixedArray[Int] = [
  0, 8, 8, 80, 65, 40, 48, 45, 9, 8, 9, 80, 81, 116, 115, 0, 32, 119, 42, 48, 73,
]

///|
fn drum_key(instrument : Int) -> Int {
  match instrument {
    SLEIGH => 54
    CHIP_KICK => 36
    CHIP_NOISE => 42
    RIDE => 51
    _ => -1
  }
}

///|
fn push_be(output : Array[Byte], value : Int, width : Int) -> Unit {
  for i in 0..<width {
    output.push((value >> ((width - 1 - i) * 8)).to_byte())
  }
}

///|
fn push_delta(output : Array[Byte], value : Int) -> Unit {
  let mut shift = 21
  while shift > 0 && value >> shift == 0 {
    shift -= 7
  }
  while shift > 0 {
    output.push((((value >> shift) & 127) | 128).to_byte())
    shift -= 7
  }
  output.push((value & 127).to_byte())
}

///|
fn append_track(output : Array[Byte], track : Array[Byte]) -> Unit {
  output.append([b'M', b'T', b'r', b'k'])
  push_be(output, track.length() + 4, 4)
  output.append(track)
  output.append([b'\x00', b'\xff', b'\x2f', b'\x00'])
}

///|
fn midi(notes : Array[Note], groove : Groove) -> FixedArray[Byte] {
  let instruments : Array[Int] = []
  for note in notes {
    if !instruments.contains(note.instrument) {
      instruments.push(note.instrument)
    }
  }
  let output : Array[Byte] = [b'M', b'T', b'h', b'd']
  push_be(output, 6, 4)
  push_be(output, 1, 2)
  push_be(output, instruments.length() + 1, 2)
  push_be(output, TPQ, 2)
  let conductor : Array[Byte] = [b'\x00', b'\xff', b'\x51', b'\x03']
  push_be(conductor, round(60000000.0 / groove.bpm), 3)
  conductor.append([
    b'\x00',
    b'\xff',
    b'\x58',
    b'\x04',
    groove.numerator.to_byte(),
    (if groove.denominator == 8 { 3 } else { 2 }).to_byte(),
    (if groove.denominator == 8 { 36 } else { 24 }).to_byte(),
    b'\x08',
  ])
  append_track(output, conductor)
  for i in 0..<instruments.length() {
    let instrument = instruments[i]
    let drum = drum_key(instrument)
    let channel = if drum >= 0 { 9 } else if i < 9 { i } else { i + 1 }
    let events : Array[(Int, Int, Int, Int)] = []
    for note in notes {
      if note.instrument != instrument {
        continue
      }
      let pitch = if drum >= 0 { drum } else { note.pitch }
      events.push((note.start, 144 | channel, pitch, note.velocity))
      events.push((note.start + note.duration, 128 | channel, pitch, 0))
    }
    events.sort_by(fn(a, b) {
      if a.0 == b.0 {
        a.1.compare(b.1)
      } else {
        a.0.compare(b.0)
      }
    })
    let track : Array[Byte] = []
    if drum < 0 {
      track.append([
        b'\x00',
        (192 | channel).to_byte(),
        midi_program[instrument].to_byte(),
      ])
    }
    let mut previous = 0
    for event in events {
      push_delta(track, event.0 - previous)
      track.append([event.1.to_byte(), event.2.to_byte(), event.3.to_byte()])
      previous = event.0
    }
    append_track(output, track)
  }
  FixedArray::makei(output.length(), fn(i) { output[i] })
}
