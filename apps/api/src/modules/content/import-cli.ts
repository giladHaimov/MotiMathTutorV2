import { db, closePool } from '../../db/index.js';
import { importCanonicalContent } from './importer.js';

/**
 * Content import CLI (ROLE-CONTENT-IMPORT). Non-public; run as an explicit
 * repository/deploy step (`npm run db:seed`). There is no public import route.
 */
async function main(): Promise<void> {
  try {
    const summary = await importCanonicalContent(db);
    console.log('Canonical content import complete:', JSON.stringify(summary));
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error('Content import failed:', err);
  process.exit(1);
});
