import './styles.css';
import { applyPreferences } from './store/settings.js';
import { startRouter } from './ui/router.js';
import { mountOfflineBanner } from './ui/offline-banner.js';
import { registerServiceWorker } from './platform/register-sw.js';

applyPreferences(); // before the first paint, so the wrong ground never flashes
startRouter();
mountOfflineBanner();
registerServiceWorker();
