const { spawn } = require('child_process');

const command = process.argv[2] || 'dev';
const originalArgs = process.argv.slice(3);

const modifiedArgs = [];
for (let i = 0; i < originalArgs.length; i++) {
  const arg = originalArgs[i];
  if (arg === '--host') {
    modifiedArgs.push('-H');
  } else if (arg.startsWith('--host=')) {
    modifiedArgs.push('--hostname=' + arg.substring(7));
  } else {
    modifiedArgs.push(arg);
  }
}

console.log(`Running Next.js wrapper: next ${command} ${modifiedArgs.join(' ')}`);

let nextBin;
try {
  nextBin = require.resolve('next/dist/bin/next');
} catch (e) {
  nextBin = 'next';
}

const child = spawn(
  nextBin === 'next' ? 'npx' : process.execPath,
  nextBin === 'next' ? ['next', command, ...modifiedArgs] : [nextBin, command, ...modifiedArgs],
  { stdio: 'inherit' }
);

child.on('close', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Failed to start next process:', err);
  process.exit(1);
});
