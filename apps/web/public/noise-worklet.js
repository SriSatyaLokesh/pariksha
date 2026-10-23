// #209 / Q12b: an AudioWorklet over a window, never an analyser polled on a
// frame loop — "cheap or off". This processor computes a running RMS over
// `windowMs` of audio and posts ONLY the resulting level in dB, at most
// once per window. AG2/AG3: no MediaRecorder, nothing resembling an
// AudioBuffer kept around, and no samples ever leave this file — the main
// thread (apps/web/src/lib/noise.ts) never sees anything but a number.
//
// The running sum of squares is updated in O(1) per sample (add the
// incoming sample, subtract the one the circular buffer evicts) rather
// than re-summed on every call — the whole point of Step 5's "cheap or
// off" is that this must cost nothing worth measuring on a weak machine.
class NoiseLevelProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const windowMs = options?.processorOptions?.windowMs ?? 200;
    this.windowSamples = Math.max(1, Math.round((windowMs * sampleRate) / 1000));
    this.buffer = new Float32Array(this.windowSamples);
    this.writeIndex = 0;
    this.filled = 0;
    this.sumSquares = 0;
    // Throttles postMessage to roughly once per window, not once per
    // ~2.7 ms render quantum — the main thread never needs more than one
    // level per window to run the crossing state machine.
    this.samplesSincePost = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      const outgoing = this.buffer[this.writeIndex];
      this.sumSquares += sample * sample - outgoing * outgoing;
      this.buffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.windowSamples;
      if (this.filled < this.windowSamples) this.filled++;
      this.samplesSincePost++;
    }

    if (this.filled >= this.windowSamples && this.samplesSincePost >= this.windowSamples) {
      this.samplesSincePost = 0;
      const rms = Math.sqrt(Math.max(0, this.sumSquares) / this.windowSamples);
      const level = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      this.port.postMessage({ level });
    }

    return true;
  }
}

registerProcessor("noise-level-processor", NoiseLevelProcessor);
