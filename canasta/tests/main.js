// Loads every suite, then prints the combined result.
import './melds.test.js';
import './game.test.js';
import './audit.test.js';
import './replay.test.js';
import './ai.test.js';
import './taunts.test.js';
import { report } from './harness.js';

report();
