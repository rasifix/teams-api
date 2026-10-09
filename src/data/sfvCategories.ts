import type { GroupCategory, PlayingMode } from '../types';

export const SFV_CATALOG_VERSION = '2026-10-09';
export const SFV_CATALOG_ORIGIN = `SFV category catalog; user-provided ${SFV_CATALOG_VERSION}`;

type CategoryCatalogEntry = {
  matchFormat?: Omit<PlayingMode, 'id' | 'isDefault' | 'origin'>;
  activityType: 'match' | 'tournament';
};

export const sfvCategories: Partial<Record<GroupCategory, CategoryCatalogEntry>> = {
  A: {
    activityType: 'match',
    matchFormat: {
      name: '2x45',
      numberOfPeriods: 2,
      periodLengthMinutes: 45,
      minimumPeriodsPerPlayer: 0,
      playersOnField: 11,
      minPlayersPerTeam: 11,
      maxPlayersPerTeam: 16
    }
  },
  B: {
    activityType: 'match',
    matchFormat: {
      name: '2x45',
      numberOfPeriods: 2,
      periodLengthMinutes: 45,
      minimumPeriodsPerPlayer: 0,
      playersOnField: 11,
      minPlayersPerTeam: 11,
      maxPlayersPerTeam: 16
    }
  },
  C: {
    activityType: 'match',
    matchFormat: {
      name: '2x45',
      numberOfPeriods: 2,
      periodLengthMinutes: 45,
      minimumPeriodsPerPlayer: 0,
      playersOnField: 11,
      minPlayersPerTeam: 11,
      maxPlayersPerTeam: 16
    }
  },
  D7: {
    activityType: 'match',
    matchFormat: {
      name: '4x20',
      numberOfPeriods: 4,
      periodLengthMinutes: 20,
      minimumPeriodsPerPlayer: 2,
      playersOnField: 7,
      minPlayersPerTeam: 7,
      maxPlayersPerTeam: 11
    }
  },
  D9: {
    activityType: 'match',
    matchFormat: {
      name: '4x20',
      numberOfPeriods: 4,
      periodLengthMinutes: 20,
      minimumPeriodsPerPlayer: 2,
      playersOnField: 9,
      minPlayersPerTeam: 9,
      maxPlayersPerTeam: 13
    }
  },
  E: { activityType: 'tournament' },
  F: { activityType: 'tournament' },
  G: { activityType: 'tournament' }
};

export const getCategoryCatalog = () => ({
  version: SFV_CATALOG_VERSION,
  source: 'User-provided SFV category-format data',
  categories: sfvCategories
});
