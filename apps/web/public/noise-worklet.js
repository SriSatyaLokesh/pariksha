/* global AudioWorkletProcessor, sampleRate, registerProcessor */

// Phase 8.5 (#209): AudioWorklet processor for noise level monitoring.
// Computes running RMS over windowMs of audio and posts only the level in dB,
// at most once per window.
// AG2/AG3: No recording, no PCM retention, main thread receives only a dB number.
// Sum of squares is updated in O(1) per sample via a circular buffer.

class NoiseLevelProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const windowMs = options?.processorOptions?.windowMs ?? 200;
    this.windowSamples = Math.max(1, Math.round((windowMs * sampleRate) / 1000));
    this.buffer = new Float32Array(this.windowSamples);
    this.writeIndex = 0;
    this.filled = 0;
    this.sumSquares = 0;
    // Throttles postMessage to roughly once per window
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
