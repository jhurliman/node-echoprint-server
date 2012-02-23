var http = require('http');
var urlParser = require('url');
var qs = require('querystring');
var log = require('winston');
var config = require('./config');
var server = require('./server');

// Make sure we have permission to bind to the requested port
if (config.web_port < 1024 && process.getuid() !== 0)
  throw new Error('Binding to ports less than 1024 requires root privileges');

// Start listening for web requests
server.init();

// If run_as_user is set, try to switch users
if (config.run_as_user) {
  try {
    process.setuid(config.run_as_user);
    log.info('Changed to running as user ' + config.run_as_user);
  } catch (err) {
    log.error('Failed to change to user ' + config.run_as_user + ': ' + err);
  }
}

// Now that we've dropped root privileges (if requested), setup file logging
// NOTE: Any messages logged before this will go to the console only
if (config.log_path)
  log.add(log.transports.File, { level: config.log_level, filename: config.log_path });
