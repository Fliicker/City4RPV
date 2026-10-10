import { CONFIG, PROJECT_ROOT } from './config';
import { runExtraction } from './pipeline';

runExtraction(CONFIG, PROJECT_ROOT).catch(error => {
  console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
