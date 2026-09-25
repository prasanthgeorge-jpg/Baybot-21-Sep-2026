// Local development entry point. The actual server implementation now lives
// in server.js at the project root (it's also used for production on a
// plain Node.js host such as Hetzner) - this file just keeps the existing
// `node tools/dev-server.js [port]` command working, defaulting to the
// local-dev port instead of server.js's production default.
if (!process.argv[2] && !process.env.PORT) {
    process.argv[2] = '8765';
}
require('../server.js');
