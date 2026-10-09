# Phase 0 MongoDB backup and restore

Before running later activity-model phases against shared or persistent data, create a
timestamped dump of the database used by the API. Do not use `docker-compose down -v` until
the dump has been verified.

```sh
mkdir -p backups
mongodump --uri="$MONGODB_URI" --out="backups/teams-api-$(date +%Y%m%d-%H%M%S)"
```

Verify that the dump contains the `groups` and `events` collections before making any
destructive change. To restore a selected dump:

```sh
mongorestore --uri="$MONGODB_URI" --drop backups/<timestamp>
```

The `--drop` option replaces collections with the dump and must only be used after
confirming the target URI and backup path.
