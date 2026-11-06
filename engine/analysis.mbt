///|
const TPQ = 480

///|
priv struct Frame {
  pitch : Int
  time : Double
  confidence : Double
}

///|
priv struct Segment {
  pitch : Int
  start : Double
  duration : Double
  confidence : Double
}

///|
priv struct Note {
  pitch : Int
  start : Int
  duration : Int
  velocity : Int
  confidence : Double
  instrument : Int
}

///|
priv struct Chord {
  root : Int
  third : Int
  fifth : Int
  seventh : Int
  start : Int
  duration : Int
  confidence : Double
}

///|
fn round(x : Double) -> Int {
  @math.floor(x + 0.5).to_int()
}

///|
fn pitch_class(pitch : Int) -> Int {
  (pitch % 12 + 12) % 12
}

///|
/// The caller supplies a valid window and an energy prefix sum. Only the dot
/// product needs to scan the delayed window for each candidate lag.
fn detect_pitch(
  samples : FixedArray[Float],
  energy : FixedArray[Double],
  correlations : FixedArray[Float],
  start : Int,
  size : Int,
  rate : Double,
  min_lag : Int,
  max_lag : Int,
  current : Double,
) -> (Int, Double) {
  let mut best = min_lag
  for lag in min_lag..<=max_lag {
    let delayed = energy[start + lag + size] - energy[start + lag]
    let product = current * delayed
    let mut dot = 0.0
    for i in start..<(start + size) {
      dot += samples.unsafe_get(i).to_double() *
        samples.unsafe_get(i + lag).to_double()
    }
    correlations[lag] = Float::from_double(
      dot / (if product > 0.0 { Double::sqrt(product) } else { 1.0 }),
    )
    if lag < max_lag && correlations[lag] > correlations[best] {
      best = lag
    }
  }
  let threshold = Float::max(0.72F, correlations[best] * 0.92F)
  for lag in (min_lag + 1)..<max_lag {
    let peak = correlations[lag]
    if peak >= threshold &&
      peak > correlations[lag - 1] &&
      peak >= correlations[lag + 1] {
      let a = correlations[lag - 1].to_double()
      let b = peak.to_double()
      let c = correlations[lag + 1].to_double()
      let denominator = a - 2.0 * b + c
      let period = lag.to_double() +
        (if denominator == 0.0 { 0.0 } else { 0.5 * (a - c) / denominator })
      return (round(69.0 + 12.0 * @math.log2(rate / period / 440.0)), b)
    }
  }
  (-1, 0.0)
}

///|
fn frames_for(
  input : FixedArray[Float],
  frames : Int,
  channels : Int,
  rate : Int,
  emphasis : Bool,
) -> (Array[Frame], Double, Double) {
  let stride = Int::max(1, round(rate.to_double() / 10000.0))
  let hz = rate.to_double() / stride.to_double()
  let size = round(hz * 0.038)
  let hop = round(hz * 0.015)
  let hop_sec = hop.to_double() / hz
  let min_lag = @math.floor(hz / 1550.0).to_int()
  let max_lag = @math.ceil(hz / 73.0).to_int()
  let samples = FixedArray::make(frames / stride, 0.0F)
  let energy = FixedArray::make(samples.length() + 1, 0.0)
  let low_alpha = 1.0 - @math.exp(-2.0 * @math.PI * 165.0 / hz)
  let high_alpha = 1.0 - @math.exp(-2.0 * @math.PI * 1600.0 / hz)
  let mut low = 0.0
  let mut high = 0.0
  for i in 0..<samples.length() {
    let mut sum = 0.0
    for channel in 0..<channels {
      let base = channel * frames + i * stride
      for j in 0..<stride {
        sum += input.unsafe_get(base + j).to_double()
      }
    }
    let sample = sum / (stride * channels).to_double()
    let filtered = if emphasis {
      low += low_alpha * (sample - low)
      high += high_alpha * (sample - low - high)
      high
    } else {
      sample
    }
    samples.unsafe_set(i, Float::from_double(filtered))
    let stored = samples.unsafe_get(i).to_double()
    energy.unsafe_set(i + 1, energy.unsafe_get(i) + stored * stored)
  }
  let limit = samples.length() - size - max_lag
  let mut peak = 0.0
  for start = 0; start < limit; start = start + hop {
    let current = energy[start + size] - energy[start]
    peak = Double::max(peak, Double::sqrt(current / size.to_double()))
  }
  let result : Array[Frame] = []
  if peak < 0.001 {
    return (result, hop_sec, peak)
  }
  let correlations = FixedArray::make(max_lag + 1, 0.0F)
  for start = 0; start < limit; start = start + hop {
    let current = energy[start + size] - energy[start]
    let rms = Double::sqrt(current / size.to_double())
    let (pitch, confidence) = if rms > Double::max(0.001, peak * 0.055) {
      detect_pitch(
        samples, energy, correlations, start, size, hz, min_lag, max_lag, current,
      )
    } else {
      (-1, 0.0)
    }
    result.push({
      pitch,
      confidence,
      time: (start.to_double() + size.to_double() / 2.0) / hz,
    })
  }
  (result, hop_sec, peak)
}

///|
fn notes_from_frames(frames : Array[Frame], hop : Double) -> Array[Segment] {
  let result : Array[Segment] = []
  let mut i = 0
  while i < frames.length() {
    let first = frames[i]
    let mut confidence = first.confidence
    let mut end = i + 1
    while end < frames.length() && frames[end].pitch == first.pitch {
      confidence += frames[end].confidence
      end += 1
    }
    let length = end - i
    if first.pitch >= 36 && first.pitch <= 96 && length >= 4 {
      result.push({
        pitch: first.pitch,
        start: Double::max(0.0, first.time - hop / 2.0),
        duration: length.to_double() * hop,
        confidence: confidence / length.to_double(),
      })
    }
    i = end
  }
  result
}

///|
fn estimate_tempo(notes : Array[Segment]) -> (Int, Double) {
  let intervals : Array[Double] = []
  for i in 1..<notes.length() {
    let interval = notes[i].start - notes[i - 1].start
    if interval >= 0.13 && interval <= 1.8 {
      intervals.push(interval)
    }
  }
  if intervals.length() < 4 {
    return (108, 0.0)
  }
  let mut best_bpm = 108
  let mut best_score = -1.0
  for bpm in 72..<=156 {
    let beat = 60.0 / bpm.to_double()
    let mut score = 0.0
    for interval in intervals {
      let nearest = Double::max(
        0.5,
        round(interval / beat * 2.0).to_double() / 2.0,
      )
      let error = (interval - nearest * beat) / 0.047
      let weight = if nearest == 1.0 {
        1.0
      } else if nearest == 0.5 {
        0.82
      } else {
        0.86
      }
      score += @math.exp(-error * error) * weight
    }
    score = score / intervals.length().to_double() -
      (bpm - 108).abs().to_double() * 0.0007
    if score > best_score {
      best_score = score
      best_bpm = bpm
    }
  }
  (if best_score > 0.55 { best_bpm } else { 108 }, Double::max(0.0, best_score))
}

///|
let major_profile : FixedArray[Double] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
]

///|
let minor_profile : FixedArray[Double] = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
]

///|
let major_scale : FixedArray[Int] = [0, 2, 4, 5, 7, 9, 11]

///|
let minor_scale : FixedArray[Int] = [0, 2, 3, 5, 7, 8, 10]

///|
let chord_prior : FixedArray[Double] = [
  1.15, 0.15, 0.05, 0.58, 0.65, 0.42, -0.45,
]

///|
fn estimate_key(notes : Array[Note]) -> (Int, Bool, Double) {
  let weight = FixedArray::make(12, 0.0)
  let mut sum = 0.0
  for note in notes {
    let duration = note.duration.to_double()
    weight[pitch_class(note.pitch)] += duration
    sum += duration
  }
  let center = sum / 12.0
  let mut variance = 0.0
  for w in weight {
    variance += (w - center) * (w - center)
  }
  let spread = if variance > 0.0 { Double::sqrt(variance) } else { 1.0 }
  let ending = pitch_class(notes[notes.length() - 1].pitch)
  let mut best_root = 0
  let mut best_minor = false
  let mut best = -2.0
  for mode in 0..<2 {
    let profile = if mode == 0 { major_profile } else { minor_profile }
    let mut total = 0.0
    for value in profile {
      total += value
    }
    let mean = total / 12.0
    let mut magnitude = 0.0
    for value in profile {
      magnitude += (value - mean) * (value - mean)
    }
    for root in 0..<12 {
      let mut fit = 0.0
      for i in 0..<12 {
        fit += (profile[i] - mean) * (weight[(i + root) % 12] - center)
      }
      fit = fit / (Double::sqrt(magnitude) * spread) +
        (if ending == root { 0.075 } else { 0.0 })
      if fit > best {
        best = fit
        best_root = root
        best_minor = mode == 1
      }
    }
  }
  (best_root, best_minor, best.clamp(min=0.0, max=1.0))
}

///|
fn infer_chords(
  notes : Array[Note],
  root : Int,
  minor : Bool,
  ticks : Int,
  bar : Int,
  chroma : Array[FixedArray[Double]],
) -> Array[Chord] {
  let scale = if minor { minor_scale } else { major_scale }
  let chords : Array[Chord] = []
  for start = 0; start < ticks; start = start + bar {
    let end = start + bar
    let mut best : Chord = {
      root: 0,
      third: 4,
      fifth: 7,
      seventh: 11,
      start,
      duration: Int::min(bar, ticks - start),
      confidence: 0.0,
    }
    let mut highest = -10000000000.0
    let mut runner_up = -10000000000.0
    for i in 0..<7 {
      let degree = scale[i]
      let base = pitch_class(root + degree)
      let third = pitch_class(scale[(i + 2) % 7] - degree)
      let fifth = pitch_class(scale[(i + 4) % 7] - degree)
      let seventh = pitch_class(scale[(i + 6) % 7] - degree)
      let mut score = chord_prior[i] * TPQ.to_double()
      let index = start / bar
      if index < chroma.length() {
        let measured = chroma[index]
        score += TPQ.to_double() *
          2.4 *
          (
            measured[base] * 1.35 +
            measured[(base + third) % 12] +
            measured[(base + fifth) % 12]
          )
      }
      if end >= ticks && i == 0 {
        score += 0.9 * TPQ.to_double()
      }
      for note in notes {
        let overlap = Int::min(end, note.start + note.duration) -
          Int::max(start, note.start)
        if overlap > 0 {
          let interval = pitch_class(note.pitch - base)
          let weight = if interval == 0 ||
            interval == third ||
            interval == fifth {
            1.0
          } else if interval == 1 || interval == 6 || interval == 11 {
            -0.9
          } else {
            -0.15
          }
          score += overlap.to_double() * weight
        }
      }
      if score > highest {
        runner_up = highest
        highest = score
        best = { ..best, root: base, third, fifth, seventh, }
      } else if score > runner_up {
        runner_up = score
      }
    }
    chords.push({
      ..best,
      confidence: ((highest - runner_up) / bar.to_double()).clamp(
        min=0.0,
        max=1.0,
      ),
    })
  }
  chords
}
