import { ref, type Ref } from 'vue';

// Loads data for a page: `data`, `loading`, `error`, and `reload()`. A newer load wins, so a slow
// answer for a previous project never overwrites the current one.
export function useLoad<T>(fetch: () => Promise<T>): {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<string>;
  reload: () => Promise<void>;
} {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref('');
  let request = 0;
  async function reload() {
    const mine = ++request;
    loading.value = true;
    error.value = '';
    try {
      const value = await fetch();
      if (mine === request) data.value = value;
    } catch (e) {
      if (mine === request) error.value = (e as Error).message;
    } finally {
      if (mine === request) loading.value = false;
    }
  }
  return { data, loading, error, reload };
}

// Runs a save: `busy` while it runs, the error message when it fails. Returns the result or null.
export function useSave() {
  const busy = ref(false);
  const error = ref('');
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    busy.value = true;
    error.value = '';
    try {
      return await action();
    } catch (e) {
      error.value = (e as Error).message;
      return null;
    } finally {
      busy.value = false;
    }
  }
  return { busy, error, run };
}
