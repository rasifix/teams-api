import { createBirthdayCalendar } from '../src/utils/birthdayCalendar';
import type { Player } from '../src/types';

const player = (overrides: Partial<Player>): Player => ({
  id: 'p-1',
  groupId: 'g-1',
  roles: ['player'],
  firstName: 'Mia',
  lastName: 'Muster',
  birthDate: '2014-04-12',
  level: 3,
  status: 'active',
  ...overrides
});

const assertIncludes = (value: string, expected: string): void => {
  if (!value.includes(expected)) throw new Error(`Expected calendar to include: ${expected}`);
};

const assertExcludes = (value: string, expected: string): void => {
  if (value.includes(expected)) throw new Error(`Expected calendar not to include: ${expected}`);
};

const calendar = createBirthdayCalendar('D7 Juniors', [
  player({ id: 'active', firstName: 'Zoë', lastName: 'Muster', birthDate: '2014-04-12' }),
  player({ id: 'leap', firstName: 'Leap', lastName: 'Child', birthDate: '2016-02-29' }),
  player({ id: 'trial', firstName: 'Trial', status: 'trial' }),
  player({ id: 'inactive', firstName: 'Inactive', status: 'inactive' }),
  player({ id: 'invalid', firstName: 'Invalid', birthDate: '2015-02-30' }),
  player({ id: 'missing', firstName: 'Missing', birthDate: undefined })
], new Date('2026-10-15T08:30:00Z'));

assertIncludes(calendar, 'BEGIN:VCALENDAR');
assertIncludes(calendar, 'DTSTAMP:20261015T083000Z');
assertIncludes(calendar, 'DTSTART;VALUE=DATE:20000412');
assertIncludes(calendar, 'DTSTART;VALUE=DATE:20000229');
assertIncludes(calendar, 'RRULE:FREQ=YEARLY');
assertIncludes(calendar, 'SUMMARY:🎂 Zoë Muster');
assertExcludes(calendar, '20140412');
assertExcludes(calendar, 'Trial');
assertExcludes(calendar, 'Inactive');
assertExcludes(calendar, 'Invalid');
assertExcludes(calendar, 'Missing');

const escaped = createBirthdayCalendar('Juniors, D7', [player({ firstName: 'Mia,', lastName: 'Muster;Test' })]);
assertIncludes(escaped, 'X-WR-CALNAME:🎂 Juniors\\, D7');
assertIncludes(escaped, 'SUMMARY:🎂 Mia\\, Muster\\;Test');

console.log('Birthday calendar tests passed.');
