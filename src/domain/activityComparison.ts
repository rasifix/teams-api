import { createHash } from 'node:crypto';
import type { Activity } from '../types';

export interface ActivityDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface ActivityComparison {
  equal: boolean;
  expectedHash: string;
  actualHash: string;
  differences: ActivityDifference[];
}

/**
 * Compares an event-replayed Activity with the legacy Activity projection.
 * Dates and object key order are normalized so storage representation does not
 * create false positives. Arrays remain ordered because their order is part
 * of the Activity contract.
 */
export function compareActivities(expected: Activity, actual: Activity): ActivityComparison {
  const expectedJson = canonicalJson(expected);
  const actualJson = canonicalJson(actual);
  const differences: ActivityDifference[] = [];

  if (expectedJson !== actualJson) {
    collectDifferences(JSON.parse(expectedJson), JSON.parse(actualJson), '$', differences);
  }

  return {
    equal: differences.length === 0,
    expectedHash: hash(expectedJson),
    actualHash: hash(actualJson),
    differences
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      const nestedValue = (value as Record<string, unknown>)[key];
      if (nestedValue !== undefined) sorted[key] = normalize(nestedValue);
      return sorted;
    }, {});
}

function collectDifferences(
  expected: unknown,
  actual: unknown,
  path: string,
  differences: ActivityDifference[]
): void {
  if (Object.is(expected, actual)) return;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      differences.push({ path, expected, actual });
      return;
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferences(expected[index], actual[index], `${path}[${index}]`, differences);
    }
    return;
  }

  if (isObject(expected) || isObject(actual)) {
    if (!isObject(expected) || !isObject(actual)) {
      differences.push({ path, expected, actual });
      return;
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      collectDifferences(expected[key], actual[key], `${path}.${key}`, differences);
    }
    return;
  }

  differences.push({ path, expected, actual });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
