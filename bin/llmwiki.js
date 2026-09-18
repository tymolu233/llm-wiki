#!/usr/bin/env node

import { runCli } from '../dist/cli.js';

runCli(process.argv).then((code) => {
  if (code !== 0) {
    process.exit(code);
  }
}).catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
