import { readFile } from 'node:fs/promises';
import { connectDatabase } from './lib/database.mjs';
import { assertIsolatedDatabase } from './test-fs.mjs';
assertIsolatedDatabase(process.env);
const scope = JSON.parse(await readFile('.runtime/delivery-ui-sandbox.json', 'utf8'));
const db = await connectDatabase();
try {
  const mode = process.argv[2];
  if (mode === 'archive' || mode === 'restore') {
    await db.query(
      "UPDATE app.project SET status=$2,archived_at=CASE WHEN $2::varchar='archived' THEN now() ELSE NULL END WHERE id=$1 AND organization_id=$3",
      [scope.projectId, mode === 'archive' ? 'archived' : 'active', scope.organizationId],
    );
  } else if (mode === 'deny' || mode === 'allow') {
    await db.query('UPDATE app.project_member SET status=$3 WHERE project_id=$1 AND user_id=$2', [
      scope.projectId,
      scope.actorId,
      mode === 'deny' ? 'removed' : 'active',
    ]);
  } else if (mode === 'conflict') {
    await db.query(
      'UPDATE app.development_item SET row_version=row_version+1 WHERE id=$1 AND organization_id=$2',
      [scope.itemId, scope.organizationId],
    );
  } else if (mode === 'verify') {
    console.log(
      (
        await db.query(
          "SELECT code,name,deleted_at IS NOT NULL AS deleted,row_version FROM app.development_item WHERE project_id=$1 AND (code='DEV-0046' OR id=$2)",
          [scope.projectId, scope.itemId],
        )
      ).rows,
    );
  } else throw Error('Unknown sandbox control');
  console.log('Sandbox control:', mode);
} finally {
  await db.end();
}
