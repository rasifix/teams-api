import type { Activity } from '../types';

export function attendanceTimingError(activity: Activity, now = Date.now()): string | null {
  return Date.parse(activity.startsAt) >= now
    ? 'Attendance can only be recorded after the activity starts'
    : null;
}

/** A started Activity (or one with attendance) has a fixed selection. */
export function selectionTimingError(current: Activity, next: Activity, now = Date.now()): string | null {
  const selected = (activity: Activity): string[] => activity.teams
    .flatMap(team => team.selectedPlayers.map(playerId => `${team.id}:${playerId}`))
    .sort();
  const before = selected(current);
  const after = selected(next);
  if (before.length === after.length && before.every((entry, index) => entry === after[index])) return null;
  if ((current.attendance?.length ?? 0) > 0 || Date.parse(current.startsAt) <= now) {
    return 'Selection cannot change after the activity starts or attendance is recorded';
  }
  return null;
}
