export function wav() {
  // Generated in memory, never committed as uploaded media.
  const data = Buffer.alloc(44 + 3200);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(3200, 40);
  return data;
}
export const audioUpload = () => ({ bytes: wav(), metadata: { kind: 'audio', extension: 'wav', mime: 'audio/wav' } });

