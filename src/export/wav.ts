import { readFileSync, writeFileSync } from "node:fs";

export const SAMPLE_RATE = 44100;

export interface Pcm {
  sampleRate: number;
  /** Mono samples in -1..1. */
  samples: Float32Array;
}

/** Writes 16-bit mono PCM. */
export function writeWav(path: string, pcm: Pcm): void {
  const { samples, sampleRate } = pcm;
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(1, 22); // channels
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}

/**
 * Reads a 16-bit PCM WAV, downmixing to mono. Only what this project writes
 * and what a user is likely to drop into `assets/audio/` — anything more exotic
 * gets a clear error rather than silent garbage.
 */
export function readWav(path: string): Pcm {
  const buffer = readFileSync(path);
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`${path}: not a RIFF/WAV file`);
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = SAMPLE_RATE;
  let bitsPerSample = 16;
  let format = 1;
  let data: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    offset = body + size + (size % 2);
  }

  if (!data) throw new Error(`${path}: no data chunk`);
  if (format !== 1 || bitsPerSample !== 16) {
    throw new Error(`${path}: only 16-bit PCM WAV is supported (got format ${format}, ${bitsPerSample}-bit)`);
  }

  const frames = Math.floor(data.length / 2 / channels);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += data.readInt16LE((i * channels + c) * 2) / 32768;
    samples[i] = sum / channels;
  }
  return { sampleRate, samples };
}
