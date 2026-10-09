import { fault } from './policy.mjs';

export const objectIdentity =
  /^(section-[1-8]|(?:scenario|rule|field)-[A-Za-z0-9][A-Za-z0-9_-]{0,100})$/;

// Build the complete candidate before mutating the authoritative task. Artifact snapshots
// retain old object contents and links; dependency endpoints refer to exact versions.
export function applyObjectChanges(objects, changes, evidence) {
  const next = structuredClone(objects),
    changed = new Set();
  for (let change of changes) {
    if (!objectIdentity.test(change.object_id) || changed.has(change.object_id))
      throw fault('OUT_OF_SCOPE', 'OUTPUT_VALIDATION');
    const old = objects[change.object_id];
    // A review-repair round revises the uncommitted candidate, so the model labels its own
    // new objects REVISE/1; with no committed object there is nothing to conflict with.
    if (!old) change = { ...change, op: 'ADD', base_version: 0 };
    if ((old?.version ?? 0) !== change.base_version || (change.op === 'ADD') === !!old)
      throw fault('VERSION_CONFLICT', 'BUSINESS_COMMIT');
    changed.add(change.object_id);
    next[change.object_id] = {
      ...structuredClone(change),
      kind: change.object_id.split('-')[0].toUpperCase(),
      version: (old?.version ?? 0) + 1,
    };
  }
  if (Object.keys(next).length > 200) throw fault('OUT_OF_SCOPE', 'OUTPUT_VALIDATION');
  const targets = new Map(evidence.map((e) => [e.id, e.source_version]));
  for (const object of Object.values(next)) targets.set(object.object_id, object.version);
  for (const object of Object.values(next)) {
    if (changed.has(object.object_id)) {
      object.dependency_links = object.dependencies.map((id) => {
        if (!targets.has(id) || id === object.object_id)
          throw fault('UNKNOWN_REFERENCE', 'OUTPUT_VALIDATION');
        return {
          source_id: object.object_id,
          source_version: object.version,
          target_id: id,
          target_version: targets.get(id),
          purpose: 'SUPPORTS',
        };
      });
    } else if (
      (object.dependency_links ?? []).some(
        (link) => targets.get(link.target_id) !== link.target_version,
      )
    ) {
      throw fault('DEPENDENCY_REVIEW_REQUIRED', 'OUTPUT_VALIDATION');
    }
  }
  return next;
}
