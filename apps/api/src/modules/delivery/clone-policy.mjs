export const basicKeys = [
  'name',
  'module',
  'kind',
  'changeType',
  'priority',
  'summary',
  'summaryFormat',
  'acceptance',
];
export function cloneFields(source) {
  return Object.fromEntries(
    basicKeys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  );
}
