import { createApp } from 'vue';
import App from './App.vue';
import '@fontsource-variable/inter';
import './assets/theme.css';
import './components/base/base.css';
import './assets/elements.css';
import './features/admin/admin.css';
import { router } from './router';

createApp(App).use(router).mount('#app');
