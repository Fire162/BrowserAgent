import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, 'package.py');

try {
  execSync(`python3 "${scriptPath}"`, { stdio: 'inherit' });
} catch (err) {
  process.exit(1);
}
