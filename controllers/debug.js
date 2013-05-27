var async = require('async');
var urlParser = require('url');
var log = require('winston');
var fingerprinter = require('./fingerprinter');
var server = require('../server');
var config = require('../config');

/**
 * Browser-friendly query debugging endpoint.
 */
exports.debugQuery = function(req, res) {
  if (!req.body || !req.body.json)
    return server.renderView(req, res, 200, 'debug.jade', {});
  
  var json, code, codeVer;
  try {
    json = JSON.parse(req.body.json)[0];
    code = json.code;
    codeVer = json.metadata.version.toString();
  } catch (err) {
    log.warn('Failed to parse JSON debug input: ' + err);
  }
  
  if (!code || !codeVer || codeVer.length !== 4) {
    return server.renderView(req, res, 500, 'debug.jade',
      { err: 'Unrecognized input' });
  }

  if (req.body.Ingest) {
    delete req.body.json;
    req.body.code = code;
    req.body.version = codeVer;
    req.body.track = json.metadata.title;
    req.body.length = json.metadata.duration;
    req.body.artist = json.metadata.artist;
    return require('./api').ingest(req, res);
  }

  fingerprinter.decodeCodeString(code, function(err, fp) {
    if (err) {
      log.error('Failed to decode codes for debug query: ' + err);
      return server.renderView(req, res, 500, 'debug.jade',
        { err: 'Failed to decode codes for debug query: ' + err });
    }
    
    fp.codever = codeVer;
    fp = fingerprinter.cutFPLength(fp);
    
    fingerprinter.bestMatchForQuery(fp, config.code_threshold,
      function(err, result, allMatches)
    {
      if (err) {
        log.warn('Failed to complete debug query: ' + err);
        return server.renderView(req, res, 500, 'debug.jade',
          { err: 'Failed to complete debug query: ' + err, input: req.body.json });
      }
      
      var duration = new Date() - req.start;
      log.debug('Completed debug lookup in ' + duration + 'ms. success=' +
        !!result.success + ', status=' + result.status);
      
      // TODO: Determine a useful set of data to return about the query and
      // each match and return it in an HTML view
      if (allMatches) {
        async.forEach(allMatches,
          function(match, done) {
            fingerprinter.getTrackMetadata(match, null, null, function(err) {
              match.codeLength = Math.ceil(match.length * fingerprinter.SECONDS_TO_TIMESTAMP);
              // Find each match that contributed to ascore
              getContributors(fp, match);
              delete match.codes;
              delete match.times;
              
              done(err);
            });
          },
          function(err) {
            if (err) {
              return server.renderView(req, res, 500, 'debug.jade',
                { err: 'Metadata lookup failed:' + err });
            }
            
            renderView();
          }
        );
      } else {
        renderView();
      }
      
      function renderView() {
        var json = JSON.stringify({ success: !!result.success, status: result.status,
          queryLen: fp.codes.length, matches: allMatches, queryTime: duration });
        return server.renderView(req, res, 200, 'debug.jade', { res: json,
          input: req.body.json });
      }
    });
  });
};

/**
 * Attach an array called contributors to the match object that contains one
 * entry for each matched code that is contributing to the final match score.
 * Used by the client-side JS to draw pretty pictures.
 */
function getContributors(fp, match) {
  var MAX_DIST = 32767;
  var i, j, k;
  
  match.contributors = [];
  
  if (match.codes.length < config.code_threshold)
    return;
  
  // Find the top two entries in the match histogram
  var keys = Object.keys(match.histogram);
  var array = new Array(keys.length);
  for (i = 0; i < keys.length; i++)
    array[i] = [ parseInt(keys[i], 10), match.histogram[keys[i]] ];
  array.sort(function(a, b) { return b[1] - a[1]; });
  var topOffsets = array.splice(0, 2);
  
  var matchCodesToTimes = fingerprinter.getCodesToTimes(match, fingerprinter.MATCH_SLOP);
  
  // Iterate over each {code,time} tuple in the query
  for (i = 0; i < fp.codes.length; i++) {
    var code = fp.codes[i];
    var time = Math.floor(fp.times[i] / fingerprinter.MATCH_SLOP) * fingerprinter.MATCH_SLOP;
    
    var matchTimes = matchCodesToTimes[code];
    if (matchTimes) {
      for (j = 0; j < matchTimes.length; j++) {
        var dist = Math.abs(time - matchTimes[j]);

        // If dist is in topOffsets, add a contributor object
        for (k = 0; k < topOffsets.length; k++) {
          if (dist === topOffsets[k][0]) {
            match.contributors.push({
              code: code,
              time: matchTimes[j],
              dist: dist
            });
            break;
          }
        }
      }
    }
  }
}
