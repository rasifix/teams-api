import assert from 'node:assert/strict';
import { compareActivities } from '../src/domain/activityComparison';
import type { Activity } from '../src/types';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Comparison match',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [],
  invitations: []
};

const main = (): void => {
  const equal = compareActivities(
    { ...activity, startsAt: new Date(activity.startsAt) as unknown as string },
    activity
  );
  assert.equal(equal.equal, true);
  assert.deepEqual(equal.differences, []);

  const mismatch = compareActivities(activity, { ...activity, name: 'Changed name' });
  assert.equal(mismatch.equal, false);
  assert.equal(mismatch.differences[0].path, '$.name');
  assert.equal(mismatch.differences[0].expected, 'Comparison match');
  assert.equal(mismatch.differences[0].actual, 'Changed name');

  const nested = compareActivities(
    { ...activity, teams: [{ id: 'team-1', name: 'One', strength: 2, selectedPlayers: [] }] },
    { ...activity, teams: [{ id: 'team-1', name: 'Two', strength: 2, selectedPlayers: [] }] }
  );
  assert.equal(nested.differences[0].path, '$.teams[0].name');
  console.log('Activity comparison tests passed');
};

main();
