// Basic requirement fields a test copy carries over; phases, tags and objects start empty.
export const basicKeys = [
  'name',
  'module',
  'kind',
  'changeType',
  'priority',
  'difficulty',
  'businessFunction',
  'businessOwner',
];
export function cloneFields(source) {
  return Object.fromEntries(
    basicKeys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  );
}
