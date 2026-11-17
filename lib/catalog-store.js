// No cache: a successful publication is visible on the next request.
// Missing schema/binding is supported during the first deployment. Other D1
// failures must not revive an old, deleted or blocked static artifact.
async function first(DB, sql, values = []) {
  if (!DB) return null;
  try {
    const db = DB.withSession ? DB.withSession('first-primary') : DB;
    return await db.prepare(sql).bind(...values).first();
  } catch (error) {
    if (/no such table: (?:main\.)?catalog_(state|items|files)\b/i.test(String(error?.message))) return null;
    throw error;
  }
}

export async function storedFile(DB, path) {
  const row = await first(DB, `SELECT s.revision, f.content, f.content_type
    FROM catalog_state s LEFT JOIN catalog_files f ON f.path = ? WHERE s.singleton = 1`, [path]);
  if (!row) return {ready:false};
  return {ready:true, revision:row.revision, content:row.content, contentType:row.content_type};
}

export async function storedItem(DB, id) {
  // Metadata and all files are read in one SQLite snapshot.
  const row = await first(DB, `SELECT s.revision, i.metadata_json,
    (SELECT json_group_object(bundle_path, content) FROM catalog_files WHERE item_id = i.id) AS files_json
    FROM catalog_state s LEFT JOIN catalog_items i ON i.id = ? WHERE s.singleton = 1`, [id]);
  if (!row) return {ready:false};
  return {ready:true, item:row.metadata_json ? JSON.parse(row.metadata_json) : null, files:JSON.parse(row.files_json || '{}')};
}
