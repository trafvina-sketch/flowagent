import { execSync } from 'child_process';

const ports = [3000, 8100, 7575];

console.log('=== Pre-dev: Checking and cleaning up ports ===');

for (const port of ports) {
  try {
    if (process.platform === 'win32') {
      const cmd = `netstat -ano | findstr :${port} | findstr LISTENING`;
      let stdout = '';
      try {
        stdout = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
      } catch (err) {
        // netstat returns exit code 1 if no match found, which throws in execSync
        continue;
      }
      
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          console.log(`Port ${port} is occupied by PID ${pid}. Killing it...`);
          try {
            execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 });
            console.log(`Port ${port} (PID ${pid}) killed successfully.`);
          } catch (e) {
            console.error(`Failed to kill PID ${pid} on port ${port}:`, e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error(`Error checking port ${port}:`, e.message);
  }
}

console.log('=== Port cleanup complete ===');
