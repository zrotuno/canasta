// Loads every suite, then prints the combined result.
import './melds.test.js';
import './game.test.js';
import './audit.test.js';
import { report } from './harness.js';

report();
