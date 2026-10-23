'use strict';
const fs = require('node:fs');
const path = require('node:path');

let stream = null;

function init(dir) {
  try {
    const file = path.join(dir, 'main.log');
    // keep the log small: rotate once it passes 2 MB
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.renameSync(file, path.join(dir, 'main.old.log'));
    }
    stream = fs.createWriteStream(file, { flags: 'a' });
  } catch {
    stream = null;
  }
}

function write(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : safeJson(a)))
    .join(' ')}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (stream) stream.write(line + '\n');
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

module.exports = {
  init,
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};
