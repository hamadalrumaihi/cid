// search.sync — drain search_index_queue into the Meilisearch `cid` index
// (shared jobCore logic; see providers/meilisearch.ts for index setup).
// Exclusions applied before any document is built: restricted media, media
// on SIU-classified cases, entity-bound media without a case, deleted rows.
// SIU-blocked *sections* cannot be evaluated from a service-role process,
// so SIU cases are skipped wholesale; search_authorize re-checks every hit.
import { searchSync, type KindHandler } from '../jobCore.ts';

export const kind = 'search.sync';
export const queue = 'search';
export const handler: KindHandler = searchSync;
