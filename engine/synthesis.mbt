///|
const RENDER_RATE = 24000

///|
const TABLE_SIZE = 2048

///|
let sine : FixedArray[Double] = FixedArray::makei(TABLE_SIZE + 1, fn(i) {
  @math.sin(2.0 * @math.PI * i.to_double() / TABLE_SIZE.to_double())
})

///|
fn tone(cycles : Double) -> Double {
  let position = (cycles - @math.floor(cycles)) * TABLE_SIZE.to_double()
  let i = position.to_int()
  let left = sine.unsafe_get(i)
  left + (sine.unsafe_get(i + 1) - left) * (position - i.to_double())
}

///|
fn overtone(phase : Double, frequency : Double, multiple : Double) -> Double {
  if frequency * multiple < RENDER_RATE.to_double() * 0.47 {
    tone(multiple * phase)
  } else {
    0.0
  }
}

///|
fn profile(instrument : Int) -> (Double, Double, Double, Double) {
  match instrument {
    DRY_PIANO => (0.26, 0.003, 0.045, 0.0)
    DEMO_KEYS => (0.23, 0.006, 0.018, 0.0)
    CELESTA => (0.24, 0.005, 0.13, 0.0)
    PULSE => (0.15, 0.004, 0.024, 0.0)
    REED => (0.23, 0.039, 0.075, 0.0)
    VIOLIN => (0.24, 0.060, 0.13, 0.0)
    STRINGS => (0.081, 0.18, 0.24, -0.32)
    PIZZ => (0.13, 0.007, 0.09, -0.17)
    SLEIGH => (0.15, 0.003, 0.09, 0.58)
    SOFT_KEYS => (0.10, 0.009, 0.13, -0.46)
    BELL => (0.14, 0.003, 0.24, 0.42)
    ARP => (0.071, 0.003, 0.017, 0.36)
    TRIANGLE => (0.20, 0.006, 0.035, -0.13)
    CHIP_KICK => (0.15, 0.003, 0.025, 0.0)
    CHIP_NOISE => (0.11, 0.003, 0.03, 0.23)
    JAZZ_KEYS => (0.13, 0.007, 0.11, -0.44)
    UPRIGHT => (0.22, 0.009, 0.09, -0.12)
    RIDE => (0.10, 0.004, 0.09, 0.5)
    CELLO => (0.16, 0.09, 0.17, -0.26)
    ENSEMBLE => (0.105, 0.17, 0.24, 0.29)
    _ => (0.13, 0.055, 0.11, 0.54)
  }
}

///|
fn wave(instrument : Int, f : Double, t : Double, noise : Double) -> Double {
  let p = f * t
  match instrument {
    DRY_PIANO =>
      (0.82 * tone(p) + 0.15 * overtone(p, f, 2.0) + 0.06 * overtone(p, f, 3.0)) *
      (0.43 + 0.57 * @math.exp(-4.0 * t))
    CELESTA =>
      0.73 * tone(p) * @math.exp(-2.5 * t) +
      0.19 * tone(2.02 * p) * @math.exp(-7.0 * t) +
      0.095 * tone(3.98 * p) * @math.exp(-13.0 * t)
    DEMO_KEYS | SOFT_KEYS =>
      (0.83 * tone(p) + 0.15 * tone(2.0 * p)) * @math.exp(-2.7 * t)
    BELL =>
      (0.66 * tone(p) + 0.26 * tone(2.76 * p) + 0.07 * tone(5.4 * p)) *
      @math.exp(-6.0 * t)
    SLEIGH =>
      (
        0.32 * noise +
        0.22 * tone(3291.0 * t) +
        0.17 * tone(4583.0 * t) +
        0.14 * tone(5947.0 * t)
      ) *
      @math.exp(-24.0 * t)
    PULSE =>
      0.78 * tone(p) +
      0.44 * overtone(p, f, 2.0) +
      0.15 * overtone(p, f, 3.0) -
      0.12 * overtone(p, f, 5.0) -
      0.11 * overtone(p, f, 6.0) -
      0.05 * overtone(p, f, 7.0) +
      0.08 * overtone(p, f, 9.0)
    ARP =>
      0.85 * tone(p) +
      0.24 * overtone(p, f, 3.0) +
      0.14 * overtone(p, f, 5.0) +
      0.10 * overtone(p, f, 7.0) +
      0.07 * overtone(p, f, 9.0)
    TRIANGLE =>
      0.91 * tone(p) -
      0.101 * overtone(p, f, 3.0) +
      0.036 * overtone(p, f, 5.0) -
      0.019 * overtone(p, f, 7.0)
    CHIP_KICK =>
      tone(43.0 * t + 3.3 * (1.0 - @math.exp(-35.0 * t))) * @math.exp(-18.0 * t)
    CHIP_NOISE => noise * @math.exp(-20.0 * t)
    REED => {
      let phase = p + 0.02069014 * tone(5.1 * t) * Double::min(t * 3.0, 1.0)
      0.67 * tone(phase) +
      0.21 * tone(2.0 * phase) +
      0.19 * tone(3.0 * phase) +
      0.07 * tone(4.0 * phase) +
      0.025 * noise
    }
    JAZZ_KEYS =>
      (
        0.71 * tone(p) +
        0.22 * tone(2.0 * p) * @math.exp(-7.0 * t) +
        0.10 * tone(3.0 * p)
      ) *
      @math.exp(-3.8 * t)
    UPRIGHT | PIZZ =>
      (
        0.85 * tone(p) +
        0.27 * tone(2.0 * p) * @math.exp(-13.0 * t) +
        0.13 * tone(3.0 * p) * @math.exp(-17.0 * t)
      ) *
      @math.exp(-5.4 * t)
    RIDE =>
      (0.74 * noise + 0.20 * tone(4061.0 * t) + 0.08 * tone(5869.0 * t)) *
      @math.exp(-17.0 * t)
    VIOLIN | CELLO => {
      let phase = p + 0.05092958 * tone(5.2 * t) * Double::min(t * 4.0, 1.0)
      0.54 * tone(phase) +
      0.28 * tone(2.0 * phase) +
      0.14 * tone(3.0 * phase) +
      0.11 * tone(4.0 * phase) +
      0.06 * tone(6.0 * phase)
    }
    STRINGS | ENSEMBLE =>
      0.42 * tone(p) +
      0.22 * tone(1.003 * p) +
      0.19 * tone(0.997 * p) +
      0.14 * tone(2.004 * p) +
      0.075 * tone(3.006 * p)
    _ =>
      0.87 * tone(p + 0.03023944 * tone(4.8 * t)) +
      0.11 * tone(p * 2.0) +
      0.023 * noise
  }
}

///|
fn synthesize(
  notes : Array[Note],
  bpm : Int,
  size : Int,
  echo : Bool,
) -> (FixedArray[Float], Double) {
  let samples = FixedArray::make(size * 2, 0.0F)
  let rate = RENDER_RATE.to_double()
  let seconds_per_tick = 60.0 / (bpm * TPQ).to_double()
  for note in notes {
    let (gain, attack, release, pan) = profile(note.instrument)
    let left = Double::sqrt((1.0 - pan) * 0.5)
    let right = Double::sqrt((1.0 + pan) * 0.5)
    let frequency = 440.0 * @math.pow(2.0, (note.pitch - 69).to_double() / 12.0)
    let start = round(note.start.to_double() * seconds_per_tick * rate)
    let duration = note.duration.to_double() * seconds_per_tick
    let end = Int::min(
      size,
      start + @math.ceil((duration + release) * rate).to_int(),
    )
    let amplitude = gain * note.velocity.to_double() / 100.0
    let mut random = 521288629U
    let mut previous = 0.0
    for i in start..<end {
      let t = (i - start).to_double() / rate
      let envelope = Double::min(
        1.0,
        Double::min(t / attack, (duration + release - t) / release),
      )
      random = random ^ (random << 13)
      random = random ^ (random >> 17)
      random = random ^ (random << 5)
      let sample = random.reinterpret_as_int().to_double() / 2147483648.0
      let noise = (sample - previous) * 0.5
      previous = sample
      let value = amplitude *
        envelope *
        wave(note.instrument, frequency, t, noise)
      samples.unsafe_set(
        i,
        Float::from_double(samples.unsafe_get(i).to_double() + value * left),
      )
      samples.unsafe_set(
        i + size,
        Float::from_double(
          samples.unsafe_get(i + size).to_double() + value * right,
        ),
      )
    }
  }
  let mut peak = 0.0
  let delay_l = 2232
  let delay_r = 3096
  for i in 0..<size {
    let mut left = samples.unsafe_get(i).to_double()
    let mut right = samples.unsafe_get(i + size).to_double()
    if echo && i >= delay_r {
      left += 0.115 * samples.unsafe_get(i - delay_l + size).to_double()
      right += 0.13 * samples.unsafe_get(i - delay_r).to_double()
    }
    let fade = Double::min(1.0, (size - 1 - i).to_double() / (rate * 0.025))
    left *= fade
    right *= fade
    samples.unsafe_set(i, Float::from_double(left))
    samples.unsafe_set(i + size, Float::from_double(right))
    peak = Double::max(peak, Double::max(left.abs(), right.abs()))
  }
  if peak >= 0.002 {
    let scale = Float::from_double(0.83 / peak)
    for i in 0..<samples.length() {
      samples.unsafe_set(i, samples.unsafe_get(i) * scale)
    }
  }
  (samples, peak)
}
