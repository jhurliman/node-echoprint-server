var urlParser = require('url');
var log = require('winston');
var fingerprinter = require('./fingerprinter');
var server = require('../server');
var config = require('../config');

/**
 * Querying for the closest matching track.
 */
exports.query = function(req, res) {
  var url = urlParser.parse(req.url, true);
  var code = url.query.code;
  if (!code)
    return server.respond(req, res, 500, { error: 'Missing code' });
  
  var codeVer = url.query.version;
  if (codeVer != config.codever)
    return server.respond(req, res, 500, { error: 'Missing or invalid version' });
  
  fingerprinter.decodeCodeString(code, function(err, fp) {
    if (err) {
      log.error('Failed to decode codes for query: ' + err);
      return server.respond(req, res, 500, { error: 'Failed to decode codes for query: ' + err });
    }
    
    fp.codever = codeVer;
    
    fingerprinter.bestMatchForQuery(fp, config.code_threshold, function(err, result) {
      if (err) {
        log.warn('Failed to complete query: ' + err);
        return server.respond(req, res, 500, { error: 'Failed to complete query: ' + err });
      }
      
      var duration = new Date() - req.start;
      log.debug('Completed lookup in ' + duration + 'ms. success=' +
        !!result.success + ', status=' + result.status);
      
      return server.respond(req, res, 200, { success: !!result.success,
        status: result.status, match: result.match || null });
    });
  });
};

/**
 * Adding a new track to the database.
 */
exports.ingest = function(req, res) {
  var code = req.body.code;
  var codeVer = req.body.version;
  var length = req.body.length;
  var track = req.body.track;
  var artist = req.body.artist;
  
  if (!code)
    return server.respond(req, res, 500, { error: 'Missing "code" field' });
  if (!codeVer)
    return server.respond(req, res, 500, { error: 'Missing "version" field' });
  if (codeVer != config.codever)
    return server.respond(req, res, 500, { error: 'Version "' + codeVer + '" does not match required version "' + config.codever + '"' });
  if (isNaN(parseInt(length, 10)))
    return server.respond(req, res, 500, { error: 'Missing or invalid "length" field' });
  if (!track)
    return server.respond(req, res, 500, { error: 'Missing "track" field' });
  if (!artist)
    return server.respond(req, res, 500, { error: 'Missing "artist" field' });
  
  fingerprinter.decodeCodeString(code, function(err, fp) {
    if (err || !fp.codes.length) {
      log.error('Failed to decode codes for ingest: ' + err);
      return server.respond(req, res, 500, { error: 'Failed to decode codes for ingest: ' + err });
    }
    
    fp.codever = codeVer;
    fp.track = track;
    fp.length = length;
    fp.artist = artist;
    
    fingerprinter.ingest(fp, function(err, result) {
      if (err) {
        log.error('Failed to ingest track: ' + err);
        return server.respond(req, res, 500, { error: 'Failed to ingest track: ' + err });
      }
      
      var duration = new Date() - req.start;
      log.debug('Ingested new track in ' + duration + 'ms. track_id=' +
        result.track_id + ', artist_id=' + result.artist_id);
      
      result.success = true;
      return server.respond(req, res, 200, result);
    });
  });
};
