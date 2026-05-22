const net = require('net');

// Ask the OS for a free port by binding to port 0, reading the assigned port,
// then immediately releasing it. There is a brief window between release and
// use, but this is standard practice for test port selection.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

module.exports = { findFreePort };
