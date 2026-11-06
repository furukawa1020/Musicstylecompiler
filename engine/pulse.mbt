///|
/// Subtract the previous frame's log energy in several frequency bands. This
/// gives a second timing cue when note onsets alone disagree about the beat.
fn estimate_pulse(
  pcm : FixedArray[Float],
  frames : Int,
  channels : Int,
  rate : Int,
) -> (Int, Double) {
  let hop = rate / 100
  let samples = frames / hop
  if samples < 400 {
    return (108, 0.0)
  }
  let flux = FixedArray::make(samples, 0.0)
  let last = FixedArray::make(3, 0.0)
  let energy = FixedArray::make(3, 0.0)
  let low_coeff = 1.0 - @math.exp(-2.0 * @math.PI * 160.0 / rate.to_double())
  let mid_coeff = 1.0 - @math.exp(-2.0 * @math.PI * 1700.0 / rate.to_double())
  let mut low = 0.0
  let mut mid = 0.0
  let mut sum = 0.0
  for frame in 0..<samples {
    for band in 0..<3 {
      energy[band] = 0.0
    }
    for i in (frame * hop)..<((frame + 1) * hop) {
      let left = pcm.unsafe_get(i).to_double()
      let x = if channels == 2 {
        (left + pcm.unsafe_get(i + frames).to_double()) * 0.5
      } else {
        left
      }
      low += low_coeff * (x - low)
      mid += mid_coeff * (x - mid)
      let middle = mid - low
      let high = x - mid
      energy[0] += low * low
      energy[1] += middle * middle
      energy[2] += high * high
    }
    for band in 0..<3 {
      let value = @math.ln_1p(40.0 * energy[band] / hop.to_double())
      let onset = Double::max(0.0, value - last[band])
      last[band] = value
      if frame > 0 {
        flux[frame] += onset
      }
    }
    sum += flux[frame]
  }
  let average = sum / samples.to_double()
  let score_at = fn(lag : Int) {
    let mut dot = 0.0
    let mut energy1 = 0.0
    let mut energy2 = 0.0
    for i in lag..<samples {
      let a = flux[i] - average
      let b = flux[i - lag] - average
      dot += a * b
      energy1 += a * a
      energy2 += b * b
    }
    if energy1 * energy2 > 0.0 {
      dot / Double::sqrt(energy1 * energy2)
    } else {
      0.0
    }
  }
  let mut best_bpm = 108
  let mut best_score = 0.0
  for bpm in 72..<=156 {
    let lag = round(60.0 * rate.to_double() / (hop * bpm).to_double())
    let score = 0.72 * score_at(lag) + 0.28 * score_at(lag * 2)
    if score > best_score {
      best_score = score
      best_bpm = bpm
    }
  }
  (best_bpm, best_score)
}

///|
/// Compute pitch-class evidence with narrow-band measurements, separately
/// from the monophonic melody tracker. The score is only a harmony prior.
fn audio_chroma(
  pcm : FixedArray[Float],
  frames : Int,
  channels : Int,
  rate : Int,
  bpm : Int,
  beats : Int,
  bars : Int,
) -> Array[FixedArray[Double]] {
  let stride = Int::max(1, rate / 6000)
  let hz = rate.to_double() / stride.to_double()
  let window_size = round(hz * 0.15)
  let window = FixedArray::make(window_size, 0.0)
  let weights = FixedArray::makei(window_size, fn(i) {
    1.0 - (i.to_double() * 2.0 / window_size.to_double() - 1.0).abs()
  })
  let coefficients = FixedArray::makei(36, fn(i) {
    let frequency = 440.0 * @math.pow(2.0, (i + 40 - 69).to_double() / 12.0)
    2.0 * @math.cos(2.0 * @math.PI * frequency / hz)
  })
  let result : Array[FixedArray[Double]] = []
  let samples_per_beat = 60.0 * rate.to_double() / bpm.to_double()
  for bar in 0..<bars {
    let chroma = FixedArray::make(12, 0.0)
    for beat in 0..<beats {
      let start = round(
        ((bar * beats + beat).to_double() + 0.12) * samples_per_beat,
      )
      if start + window_size * stride >= frames {
        break
      }
      for i in 0..<window_size {
        let sample = start + i * stride
        let left = pcm.unsafe_get(sample).to_double()
        let x = if channels == 2 {
          (left + pcm.unsafe_get(sample + frames).to_double()) * 0.5
        } else {
          left
        }
        window.unsafe_set(i, x * weights.unsafe_get(i))
      }
      for p in 0..<36 {
        let coefficient = coefficients.unsafe_get(p)
        let mut last = 0.0
        let mut before = 0.0
        for x in window {
          let next = x + coefficient * last - before
          before = last
          last = next
        }
        let power = Double::max(
          0.0,
          last * last + before * before - coefficient * last * before,
        )
        chroma[(p + 40) % 12] += Double::sqrt(power)
      }
    }
    let mut sum = 0.0
    for value in chroma {
      sum += value
    }
    if sum > 0.0 {
      for i in 0..<12 {
        chroma[i] /= sum
      }
    }
    result.push(chroma)
  }
  result
}
