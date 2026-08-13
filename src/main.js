import './styles.css';
import { applyTheme } from './store/settings.js';
import { startRouter } from './ui/router.js';

applyTheme(); // before the first paint, so the wrong theme never flashes
startRouter();
