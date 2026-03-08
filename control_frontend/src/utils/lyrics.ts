export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

export interface LineProgress {
  fill: number;
}

export function getApproximateWordIndex(text: string, fill: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;
  return Math.max(0, Math.min(words.length - 1, Math.floor(fill * words.length)));
}

export function fmt(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseTimestampToMs(timestamp: string): number | null {
  const match = timestamp.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? "0";
  const millis = Number(fraction.padEnd(3, "0").slice(0, 3));
  return (minutes * 60 + seconds) * 1000 + millis;
}

export function parseSyncedLyrics(lyrics: string | null | undefined): SyncedLyricLine[] {
  if (!lyrics) return [];

  return lyrics
    .split("\n")
    .flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d+:\d{2}(?:\.\d{1,3})?)\]/g)];
      const withoutLineTags = line.replace(/\[[^\]]+\]/g, "");
      const text = withoutLineTags.replace(/<[^>]+>/g, "").trim();

      if (!matches.length || !text) return [];

      return matches
        .map((match) => parseTimestampToMs(match[1]))
        .filter((timeMs): timeMs is number => timeMs !== null)
        .map((timeMs) => ({ timeMs, text }));
    })
    .sort((left, right) => left.timeMs - right.timeMs);
}

export function findActiveLyricIndex(lines: SyncedLyricLine[], progressMs: number): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (progressMs >= lines[index].timeMs) return index;
  }

  return -1;
}

export function getLineProgress(
  lines: SyncedLyricLine[],
  lineIndex: number,
  progressMs: number,
  trackDurationMs: number,
): LineProgress {
  const line = lines[lineIndex];
  const nextLineStart = lines[lineIndex + 1]?.timeMs ?? trackDurationMs;
  const segmentDuration = Math.max(500, nextLineStart - line.timeMs);
  const clamped = Math.max(0, Math.min(segmentDuration, progressMs - line.timeMs));
  const fill = Math.max(0, Math.min(1, clamped / segmentDuration));

  return { fill };
}
