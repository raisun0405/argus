// The first of the landing page's modules (main.js imports it before the others), so a fault in any of
// them is reported too (services/errorReporter.ts)
import { startErrorReports } from '../services/errorReporter';

startErrorReports();
