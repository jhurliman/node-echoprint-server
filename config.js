/**
 * Configuration variables. These can be overridden in the per-system config file 
 */

var log = require('winston');

var settings = {
  // Port that the web server will bind to
  web_port: 37760,
  
  // Database settings
  db_user: 'root',
  db_pass: '',
  db_database: 'echoprint',
  db_host: 'localhost',
  
  // Set this to a system username to drop root privileges
  run_as_user: '',
  
  // Filename to log to
  log_path: __dirname + '/logs/echoprint.log',
  // Log level. Valid values are debug, info, warn, error
  log_level: 'debug',
  
  // Minimum number of codes that must be matched to consider a fingerprint
  // match valid
  code_threshold: 10
};

// Override default settings with any local settings
try {
  var localSettings = require('./config.local');
  
  for (var property in localSettings) {
    if (localSettings.hasOwnProperty(property))
      settings[property] = localSettings[property];
  }
  
  log.info('Loaded settings from config.local.js. Database is ' +
    settings.db_database + '@' + settings.db_host);
} catch (err) {
  log.warn('Using default settings from config.js. Database is ' +
    settings.db_database + '@' + settings.db_host);
}

module.exports = settings;
