import type { Player } from '../types';

const CALENDAR_START_YEAR = '2000';

function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldCalendarLine(line: string): string {
  const chunks: string[] = [];
  let chunk = '';
  let byteLength = 0;

  for (const character of line) {
    const characterLength = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterLength > 73 && chunk) {
      chunks.push(chunk);
      chunk = character;
      byteLength = characterLength;
    } else {
      chunk += character;
      byteLength += characterLength;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks.join('\r\n ');
}

function toBirthdayDate(birthDate: string | undefined): string | null {
  const match = birthDate?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${CALENDAR_START_YEAR}${match[1]}${match[2]}`;
}

export function createBirthdayCalendar(groupName: string, players: Player[], generatedAt: Date = new Date()): string {
  const timestamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const events = players
    .filter((player) => (player.status ?? 'active') === 'active')
    .map((player) => ({ player, date: toBirthdayDate(player.birthDate) }))
    .filter((entry): entry is { player: Player; date: string } => entry.date !== null)
    .sort((left, right) => {
      const dateComparison = left.date.slice(4).localeCompare(right.date.slice(4));
      if (dateComparison !== 0) return dateComparison;
      return `${left.player.lastName} ${left.player.firstName}`.localeCompare(
        `${right.player.lastName} ${right.player.firstName}`
      );
    })
    .flatMap(({ player, date }) => [
      'BEGIN:VEVENT',
      `UID:birthday-${escapeCalendarText(player.id)}@teams`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      'RRULE:FREQ=YEARLY',
      `SUMMARY:${escapeCalendarText(`🎂 ${player.firstName} ${player.lastName}`)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    ]);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//My Teams//Birthday Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeCalendarText(`🎂 ${groupName}`)}`,
    ...events,
    'END:VCALENDAR'
  ];

  return `${lines.map(foldCalendarLine).join('\r\n')}\r\n`;
}
