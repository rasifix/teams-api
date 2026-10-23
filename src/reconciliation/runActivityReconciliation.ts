import 'dotenv/config';
import { mongoConnection } from '../database/connection';
import { activityReconciler } from '../domain/activityReconciler';

const requestedSquad = (): string | undefined => {
  const argument = process.argv.slice(2).find(value => value.startsWith('--squad='));
  return argument?.slice('--squad='.length) || process.env.RECONCILE_SQUAD_ID || undefined;
};

const run = async (): Promise<void> => {
  await mongoConnection.connect();
  try {
    const squadId = requestedSquad();
    const squadIds = squadId ? [squadId] : await activityReconciler.listSquadIds();
    const reports = [];

    for (const currentSquadId of squadIds) {
      reports.push({ squadId: currentSquadId, ...(await activityReconciler.reconcileSquad(currentSquadId)) });
    }

    const summary = reports.reduce((total, report) => ({
      squads: total.squads + 1,
      scanned: total.scanned + report.scanned,
      repaired: total.repaired + report.repaired,
      deleted: total.deleted + report.deleted,
      withoutEvents: total.withoutEvents + report.withoutEvents,
      failures: total.failures + report.failed.length
    }), { squads: 0, scanned: 0, repaired: 0, deleted: 0, withoutEvents: 0, failures: 0 });

    console.log(JSON.stringify({ summary, reports }, null, 2));
    if (summary.failures > 0) process.exitCode = 1;
  } finally {
    await mongoConnection.disconnect();
  }
};

void run().catch(error => {
  console.error('Activity reconciliation failed:', error);
  process.exitCode = 1;
});
