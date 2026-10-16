// randomUUID is absent on ordinary HTTP origins. getRandomValues also supports
// those origins, so manual confirmation works on both deployed site addresses.
export function createMeetingPersonId(source: Crypto = globalThis.crypto): string {
    if (typeof source.randomUUID === 'function') return `meeting:${source.randomUUID()}`;
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `meeting:${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
