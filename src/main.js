import './styles.css';
import { applyTheme } from './store/settings.js';
import { startRouter } from './ui/router.js';
import { mountOfflineBanner } from './ui/offline-banner.js';
import { registerServiceWorker } from './platform/register-sw.js';

applyTheme(); // before the first paint, so the wrong theme never flashes
startRouter();
mountOfflineBanner();
registerServiceWorker();
