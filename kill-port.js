const { execSync } = require('child_process');

const port = process.env.PORT || 3001;

console.log(`Checking for processes on port ${port}...`);

try {
  if (process.platform === 'win32') {
    // Windows logic
    const stdout = execSync(`netstat -ano | findstr :${port}`).toString();
    const lines = stdout.split('\n');
    const pids = new Set();
    
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 4) {
        const pid = parts[parts.length - 1];
        if (pid !== '0' && !isNaN(pid)) pids.add(pid);
      }
    });

    pids.forEach(pid => {
      try {
        console.log(`Killing process ${pid} using port ${port}...`);
        execSync(`taskkill /F /PID ${pid}`);
      } catch (e) {
        // Ignore if process already gone
      }
    });
  } else {
    // Linux/Mac logic (for Render)
    try {
      execSync(`lsof -t -i:${port} | xargs -r kill -9`);
      console.log(`Port ${port} cleared using lsof.`);
    } catch (e) {
      console.log(`Port ${port} is already free or lsof not found.`);
    }
  }
} catch (error) {
  console.log(`Port ${port} is already free.`);
}
