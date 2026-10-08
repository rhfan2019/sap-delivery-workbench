export function computeImpact(graph, changedIds, { maxNodes = 10000 } = {}) {
  const reverse = new Map();
  for (const edge of graph.edges) {
    const targets = reverse.get(edge.target) ?? [];
    targets.push(edge.source);
    reverse.set(edge.target, targets);
  }
  const visited = new Set(),
    queue = [...changedIds];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (visited.has(id)) continue;
    if (visited.size >= maxNodes) throw new Error('Dependency traversal budget exceeded');
    visited.add(id);
    queue.push(...(reverse.get(id) ?? []));
  }
  return [...visited]
    .sort()
    .map((entity_id) => ({ entity_id, action: 'inspect', reason: '确定性反向依赖闭包' }));
}

export function selectAtomicOperations(change, groupIds, graph) {
  const selected = new Set(groupIds),
    known = new Set(change.atomic_groups.map((g) => g.id));
  if (
    !selected.size ||
    selected.size !== groupIds.length ||
    [...selected].some((id) => !known.has(id))
  )
    throw new Error('Invalid atomic group selection');
  const included = new Set(
    change.atomic_groups.filter((g) => selected.has(g.id)).flatMap((g) => g.operation_target_ids),
  );
  const targets = new Set(change.operations.map((o) => o.target_id));
  if ([...included].some((id) => !targets.has(id)))
    throw new Error('Atomic group contains unknown target');
  for (const group of change.atomic_groups) {
    if (
      group.operation_target_ids.some((id) => included.has(id)) &&
      !group.operation_target_ids.every((id) => included.has(id))
    )
      throw new Error('Partial atomic group');
  }
  const operations = change.operations.filter((o) => included.has(o.target_id));
  if (graph)
    for (const impact of computeImpact(graph, [...included]))
      if (targets.has(impact.entity_id) && !included.has(impact.entity_id))
        throw new Error('Selected operations omit a server-derived dependency group');
  for (const op of operations)
    for (const dependency of op.value?.depends_on ?? [])
      if (targets.has(dependency) && !included.has(dependency))
        throw new Error('Selected operations omit a dependency group');
  return operations;
}

export function documentGraph(ast, entities = [], edges = []) {
  const nodes = [...entities.map((e) => ({ id: e.stable_id, kind: e.kind }))];
  const result = [...edges];
  for (const section of ast.sections) {
    nodes.push({ id: section.id, kind: 'section' });
    for (const block of section.blocks) {
      nodes.push({ id: block.id, kind: 'block' });
      result.push({ source: section.id, target: block.id });
      for (const id of [...block.rule_ids, ...block.requirement_ids, ...block.decision_ids])
        result.push({ source: block.id, target: id });
    }
  }
  for (const test of ast.tests) {
    nodes.push({ id: test.id, kind: 'test' });
    for (const id of [...test.rule_ids, ...test.requirement_ids, ...test.section_ids])
      result.push({ source: test.id, target: id });
  }
  return { nodes, edges: result };
}
