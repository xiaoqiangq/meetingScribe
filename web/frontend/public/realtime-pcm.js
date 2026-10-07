// Fractional box resampling conserves sample time across render callbacks.
export class PCMResampler {
  constructor(rate, target = 16000) {
    this.ratio = rate / target;
    this.weight = 0;
    this.sum = 0;
    this.values = [];
  }
  push(input) {
    const output = [];
    for (const value of input) {
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          output.push(Math.round(Math.max(-1, Math.min(1, this.sum / this.ratio)) * 32767));
          this.weight = 0;
          this.sum = 0;
        }
      }
    }
    return output;
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class MicrophonePCM extends AudioWorkletProcessor {
    constructor() {
      super();
      this.converter = new PCMResampler(sampleRate);
      this.pending = [];
      this.paused = false;
      this.port.onmessage = ({ data }) => {
        if (data === 'flush') {
          this.paused = true;
          this.emit();
          this.port.postMessage({ flushed: true });
        }
        if (data === 'resume') this.paused = false;
      };
    }
    emit(count = this.pending.length) {
      if (!this.pending.length) return;
      const values = this.pending.splice(0, count);
      const buffer = new ArrayBuffer(values.length * 2);
      const view = new DataView(buffer);
      values.forEach((value, i) => view.setInt16(i * 2, value, true));
      this.port.postMessage({ pcm: buffer }, [buffer]);
    }
    process(inputs) {
      if (this.paused) return true;
      const channels = inputs[0];
      if (!channels || !channels.length) return true;
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) channel.forEach((value, i) => { mono[i] += value / channels.length; });
      this.pending.push(...this.converter.push(mono));
      while (this.pending.length >= 16000) this.emit(16000);
      return true;
    }
  }
  registerProcessor('meetingscribe-microphone-pcm', MicrophonePCM);
}
