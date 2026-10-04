export function parseTopicTimes(text: string): number[] {
  const entries = text.split(/[,，\n]/).map(v => v.trim()).filter(Boolean);
  if (!entries.length || entries.length > 100) throw new Error('请输入 1–100 个分界时间，如 43:00');
  const points = entries.map(entry => {
    if (!/^\d+:\d{2}(:\d{2})?$/.test(entry)) throw new Error('时间格式应为 MM:SS 或 HH:MM:SS');
    const parts = entry.split(':').map(Number);
    if (parts[parts.length - 1] >= 60 || (parts.length === 3 && parts[1] >= 60)) throw new Error('分钟或秒数超出范围');
    return parts.reduce((sum, value) => sum * 60 + value, 0);
  });
  points.forEach((point, i) => {
    if (!Number.isFinite(point) || point <= (i ? points[i - 1] : 0)) throw new Error('分界时间必须递增、不能重复，且大于零');
  });
  return points;
}
export function formatTopicTime(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 3600).toString().padStart(2, '0')}:${Math.floor(total % 3600 / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
