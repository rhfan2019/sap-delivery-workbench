import { createApp } from 'vue';
import App from './App.vue';
import './assets/theme.css';
import './assets/elements.css';
import './features/admin/admin.css';
import { router } from './router';

createApp(App).use(router).mount('#app');
