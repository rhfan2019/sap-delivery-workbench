import { createApp } from 'vue';
import App from './App.vue';
import './assets/theme.css';
// Theme packages (contract 1.14) come after the defaults they override.
import './assets/themes/airbnb.css';
import './assets/themes/airtable.css';
import './assets/elements.css';
import './features/admin/admin.css';
import { router } from './router';
import { applyStoredTheme } from './services/theme';

applyStoredTheme();
createApp(App).use(router).mount('#app');
