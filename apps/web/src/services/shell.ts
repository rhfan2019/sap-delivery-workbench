import { ref } from 'vue';

// Shell state a page may set (DESIGN.md 4.1): a list page with a record open beside it asks for
// room, and the shell folds the secondary menu on screens narrower than 1440px.
export const detailOpen = ref(false);
