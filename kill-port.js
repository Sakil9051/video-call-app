const { execSync } = require('child_process');

try {
  console.log('Checking for processes on port 3001...');
  // Find PIDs using port 3001 on Windows
  const output = execSync('netstat -ano | findstr :3001').toString();
  const lines = output.split('\r\n').filter(line => line.trim().length > 0);
  
  const pids = new Set();
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    // The PID is usually the last element in the netstat output
    const pid = parts[parts.length - 1];
    if (pid && !isNaN(pid) && pid !== '0') {
      pids.add(pid);
    }
  });

  if (pids.size > 0) {
    pids.forEach(pid => {
      try {
        console.log(`Killing process ${pid} using port 3001...`);
        execSync(`taskkill /F /PID ${pid}`);
      } catch (err) {
        console.log(`Could not kill process ${pid} (it might have already closed).`);
      }
    });
    console.log('Port 3001 is now clear.');
  } else {
    console.log('Port 3001 is already free.');
  }
} catch (e) {
  // netstat returns exit code 1 if no matches are found
  console.log('Port 3001 is already free.');
}
