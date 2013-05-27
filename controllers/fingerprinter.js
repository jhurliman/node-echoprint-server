var zlib = require('zlib');
var log = require('winston');
var Mutex = require('../mutex');
var config = require('../config');
var database = require('../models/mysql');

// Constants
var CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
var SECONDS_TO_TIMESTAMP = 43.45;
var MAX_ROWS = 30;
var MIN_MATCH_PERCENT = 0.1;
var MATCH_SLOP = 2;

// Exports
exports.decodeCodeString = decodeCodeString;
exports.cutFPLength = cutFPLength;
exports.getCodesToTimes = getCodesToTimes;
exports.bestMatchForQuery = bestMatchForQuery;
exports.getTrackMetadata = getTrackMetadata;
exports.ingest = ingest;
exports.SECONDS_TO_TIMESTAMP = SECONDS_TO_TIMESTAMP;
exports.MATCH_SLOP = MATCH_SLOP;

// Globals
var gTimestamp = +new Date();
var gMutex = Mutex.getMutex();

/**
 * Takes a base64 encoded representation of a zlib-compressed code string
 * and passes a fingerprint object to the callback.
 */
function decodeCodeString(codeStr, callback) {
  // Fix url-safe characters
  codeStr = codeStr.replace(/-/g, '+').replace(/_/g, '/');
  
  // Expand the base64 data into a binary buffer
  var compressed = new Buffer(codeStr, 'base64');
  
  // Decompress the binary buffer into ascii hex codes
  zlib.inflate(compressed, function(err, uncompressed) {
    if (err) return callback(err, null);
    // Convert the ascii hex codes into codes and time offsets
    var fp = inflateCodeString(uncompressed);
    log.debug('Inflated ' + codeStr.length + ' byte code string into ' +
      fp.codes.length + ' codes');
    
    callback(null, fp);
  });
}

/**
 * Takes an uncompressed code string consisting of zero-padded fixed-width
 * sorted hex integers and converts it to the standard code string.
 */
function inflateCodeString(buf) {
  // 5 hex bytes for hash, 5 hex bytes for time (40 bits per tuple)
  var count = Math.floor(buf.length / 5);
  var endTimestamps = count / 2;
  var i;
  
  var codes = new Array(count / 2);
  var times = new Array(count / 2);
  
  for (i = 0; i < endTimestamps; i++) {
    times[i] = parseInt(buf.toString('ascii', i * 5, i * 5 + 5), 16);
  }
  for (i = endTimestamps; i < count; i++) {
    codes[i - endTimestamps] = parseInt(buf.toString('ascii', i * 5, i * 5 + 5), 16);
  }
  
  // Sanity check
  for (i = 0; i < codes.length; i++) {
    if (isNaN(codes[i]) || isNaN(times[i])) {
      log.error('Failed to parse code/time index ' + i);
      return { codes: [], times: [] };
    }
  }
  
  return { codes: codes, times: times };
}

/**
 * Clamp this fingerprint to a maximum N seconds worth of codes.
 */
function cutFPLength(fp, maxSeconds) {
  if (!maxSeconds) maxSeconds = 60;
  
  var newFP = {};
  for(var key in fp) {
    if (fp.hasOwnProperty(key))
     newFP[key] = fp[key];
   }
  
  var firstTimestamp = fp.times[0];
  var sixtySeconds = maxSeconds * SECONDS_TO_TIMESTAMP + firstTimestamp;
  
  for (var i = 0; i < fp.times.length; i++) {
    if (fp.times[i] > sixtySeconds) {
      log.debug('Clamping ' + fp.codes.length + ' codes to ' + i + ' codes');
      
      newFP.codes = fp.codes.slice(0, i);
      newFP.times = fp.times.slice(0, i);
      return newFP;
    }
  }
  
  newFP.codes = fp.codes.slice(0);
  newFP.times = fp.times.slice(0);
  return newFP;
}

/**
 * Finds the closest matching track, if any, to a given fingerprint.
 */
function bestMatchForQuery(fp, threshold, callback) {
  fp = cutFPLength(fp);
  
  if (!fp.codes.length)
    return callback('No valid fingerprint codes specified', null);
  
  log.debug('Starting query with ' + fp.codes.length + ' codes');
  
  database.fpQuery(fp, MAX_ROWS, function(err, matches) {
    if (err) return callback(err, null);
    
    if (!matches || !matches.length) {
      log.debug('No matched tracks');
      return callback(null, { status: 'NO_RESULTS' });
    }
    
    log.debug('Matched ' + matches.length + ' tracks, top code overlap is ' +
      matches[0].score);
    
    // If the best result matched fewer codes than our percentage threshold,
    // report no results
    if (matches[0].score < fp.codes.length * MIN_MATCH_PERCENT)
      return callback(null, { status: 'MULTIPLE_BAD_HISTOGRAM_MATCH' });
    
    // Compute more accurate scores for each track by taking time offsets into
    // account
    var newMatches = [];
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      match.ascore = getActualScore(fp, match, threshold, MATCH_SLOP);
      if (match.ascore && match.ascore >= fp.codes.length * MIN_MATCH_PERCENT)
        newMatches.push(match);
    }
    matches = newMatches;
    
    if (!matches.length) {
      log.debug('No matched tracks after score adjustment');
      return callback(null, { status: 'NO_RESULTS_HISTOGRAM_DECREASED' });
    }
    
    // Sort the matches based on actual score
    matches.sort(function(a, b) { return b.ascore - a.ascore; });
    
    // If we only had one track match, just use the threshold to determine if
    // the match is good enough
    if (matches.length === 1) {
      if (matches[0].ascore / fp.codes.length >= MIN_MATCH_PERCENT) {
        // Fetch metadata for the single match
        log.debug('Single good match with actual score ' + matches[0].ascore +
          '/' + fp.codes.length);
        return getTrackMetadata(matches[0], matches,
          'SINGLE_GOOD_MATCH_HISTOGRAM_DECREASED', callback);
      } else {
        log.debug('Single bad match with actual score ' + matches[0].ascore +
          '/' + fp.codes.length);
        return callback(null, { status: 'SINGLE_BAD_MATCH' });
      }
    }
    
    var origTopScore = matches[0].ascore;
    
    // Sort by the new adjusted score
    matches.sort(function(a, b) { return b.ascore - a.score; });
    
    var topMatch = matches[0];
    var newTopScore = topMatch.ascore;
    
    log.debug('Actual top score is ' + newTopScore + ', next score is ' +
      matches[1].ascore);
    
    // If the best result actually matched fewer codes than our percentage
    // threshold, report no results
    if (newTopScore < fp.codes.length * MIN_MATCH_PERCENT)
      return callback(null, { status: 'MULTIPLE_BAD_HISTOGRAM_MATCH' });
    
    // If the actual score was not close enough, then no match
    if (newTopScore <= origTopScore / 2)
      return callback(null, { status: 'MULTIPLE_BAD_HISTOGRAM_MATCH' });
    
    // If the difference in actual scores between the first and second matches
    // is not significant enough, then no match 
    if (newTopScore - matches[1].ascore < newTopScore / 2)
      return callback(null, { status: 'MULTIPLE_BAD_HISTOGRAM_MATCH' });
    
    // Fetch metadata for the top track
    getTrackMetadata(topMatch, matches,
      'MULTIPLE_GOOD_MATCH_HISTOGRAM_DECREASED', callback);
  });
}

/**
 * Attach track metadata to a query match.
 */
function getTrackMetadata(match, allMatches, status, callback) {
  database.getTrack(match.track_id, function(err, track) {
    if (err) return callback(err, null);
    if (!track)
      return callback('Track ' + match.track_id + ' went missing', null);
    
    match.track = track.name;
    match.artist = track.artist_name;
    match.artist_id = track.artist_id;
    match.length = track.length;
    match.import_date = track.import_date;
    
    callback(null, { success: true, status: status, match: match },
      allMatches);
  });
}

/**
 * Build a mapping from each code in the given fingerprint to an array of time
 * offsets where that code appears, with the slop factor accounted for in the 
 * time offsets. Used to speed up getActualScore() calculation.
 */
function getCodesToTimes(match, slop) {
  var codesToTimes = {};
  
  for (var i = 0; i < match.codes.length; i++) {
    var code = match.codes[i];
    var time = Math.floor(match.times[i] / slop) * slop;
    
    if (codesToTimes[code] === undefined)
      codesToTimes[code] = [];
    codesToTimes[code].push(time);
  }
  
  return codesToTimes;
}

/**
 * Computes the actual match score for a track by taking time offsets into
 * account.
 */
function getActualScore(fp, match, threshold, slop) {
  var MAX_DIST = 32767;
  
  if (match.codes.length < threshold)
    return 0;
  
  var timeDiffs = {};
  var i, j;
  
  var matchCodesToTimes = getCodesToTimes(match, slop);
  
  // Iterate over each {code,time} tuple in the query
  for (i = 0; i < fp.codes.length; i++) {
    var code = fp.codes[i];
    var time = Math.floor(fp.times[i] / slop) * slop;
    var minDist = MAX_DIST;

    var matchTimes = matchCodesToTimes[code];
    if (matchTimes) {
      for (j = 0; j < matchTimes.length; j++) {
        var dist = Math.abs(time - matchTimes[j]);

        // Increment the histogram bucket for this distance
        if (timeDiffs[dist] === undefined)
          timeDiffs[dist] = 0;
        timeDiffs[dist]++;
      }
    }
  }

  match.histogram = timeDiffs;
  
  // Convert the histogram into an array, sort it, and sum the top two
  // frequencies to compute the adjusted score
  var keys = Object.keys(timeDiffs);
  var array = new Array(keys.length);
  for (i = 0; i < keys.length; i++)
    array[i] = [ keys[i], timeDiffs[keys[i]] ];
  array.sort(function(a, b) { return b[1] - a[1]; });
  
  if (array.length > 1)
    return array[0][1] + array[1][1];
  else if (array.length === 1)
    return array[0][1];
  return 0;
}

/**
 * Takes a track fingerprint (includes codes and time offsets plus any
 * available metadata), adds it to the database and returns a track_id,
 * artist_id, and artist name if available.
 */
function ingest(fp, callback) {
  var MAX_DURATION = 60 * 60 * 4;
  
  fp.codever = fp.codever || fp.version;

  log.info('Ingesting track "' + fp.track + '" by artist "' + fp.artist +
    '", ' + fp.length + ' seconds, ' + fp.codes.length + ' codes (' + fp.codever + ')');
  
  if (!fp.codes.length)
    return callback('Missing "codes" array', null);
  if (typeof fp.length !== 'number')
    return callback('Missing or invalid "length" field', null);
  if (!fp.codever)
    return callback('Missing or invalid "version" field', null);
  if (!fp.track)
    return callback('Missing or invalid "track" field', null);
  if (!fp.artist)
    return callback('Missing or invalid "artist" field', null);

  fp = cutFPLength(fp, MAX_DURATION);
  
  // Acquire a lock while modifying the database
  gMutex.lock(function() {
    // Check if this track already exists in the database
    bestMatchForQuery(fp, config.code_threshold, function(err, res) {
      if (err) {
        gMutex.release();
        return callback('Query failed: ' + err, null);
      }
      
      if (res.success) {
        var match = res.match;
        log.info('Found existing match with status ' + res.status +
          ', track ' + match.track_id + ' ("' + match.track + '") by "' +
          match.artist + '"');
        
        var checkUpdateArtist = function() {
          if (!match.artist) {
            // Existing artist is unnamed but we have a name now. Check if this
            // artist name already exists in the database
            log.debug('Updating track artist');
            database.getArtistByName(fp.artist, function(err, artist) {
              if (err) { gMutex.release(); return callback(err, null); }
              
              if (artist) {
                log.debug('Setting track artist_id to ' + artist.artist_id);
                
                // Update the track to point to the existing artist
                database.updateTrack(match.track_id, match.track,
                  artist.artist_id, function(err)
                {
                  if (err) { gMutex.release(); return callback(err, null); }
                  match.artist_id = artist.artist_id;
                  match.artist = artist.name;
                  finished(match);
                });
              } else {
                log.debug('Setting artist ' + artist.artist_id + ' name to "' +
                  artist.name + '"');
                
                // Update the artist name
                database.updateArtist(match.artist_id, fp.artist,
                  function(err)
                {
                  if (err) { gMutex.release(); return callback(err, null); }
                  match.artist = fp.artist;
                  finished(match);
                });
              }
            });
          } else {
            if (match.artist != fp.artist) {
              log.warn('New artist name "' + fp.artist + '" does not match ' +
                'existing artist name "' + match.artist + '" for track ' +
                match.track_id);
            }
            log.debug('Skipping artist update');
            finished(match);
          }
        };
        
        var finished = function(match) {
          // Success
          log.info('Track update complete');
          gMutex.release();
          callback(null, { track_id: match.track_id, track: match.track,
            artist_id: match.artist_id, artist: match.artist });
        };
        
        if (!match.track && fp.track) {
          // Existing track is unnamed but we have a name now. Update the track
          log.debug('Updating track name to "' + fp.track + '"');
          database.updateTrack(match.track_id, fp.track, match.artist_id,
            function(err)
          {
            if (err) { gMutex.release(); return callback(err, null); }
            match.track = fp.track;
            checkUpdateArtist();
          });
        } else {
          log.debug('Skipping track name update');
          checkUpdateArtist();
        }
      } else {
        // Track does not exist in the database yet
        log.debug('Track does not exist in the database yet, status ' +
          res.status);
        
        // Does this artist already exist in the database?
        database.getArtistByName(fp.artist, function(err, artist) {
          if (err) { gMutex.release(); return callback(err, null); }
          
          if (!artist)
            createArtistAndTrack();
          else
            createTrack(artist.artist_id, artist.name);
        });
      }
      
      // Function for creating a new artist and new track
      function createArtistAndTrack() {
        log.debug('Adding artist "' + fp.artist + '"')
        database.addArtist(fp.artist, function(err, artistID) {
          if (err) { gMutex.release(); return callback(err, null); }
          
          // Success
          log.info('Created artist ' + artistID + ' ("' + fp.artist + '")');
          createTrack(artistID, fp.artist);
        });
      }
      
      // Function for creating a new track given an artistID
      function createTrack(artistID, artist) {
        log.debug('Adding track "' + fp.track + '" for artist "' + artist  + '" (' + artistID + ')');
        database.addTrack(artistID, fp, function(err, trackID) {
          if (err) { gMutex.release(); return callback(err, null); }
          
          // Success
          log.info('Created track ' + trackID + ' ("' + fp.track + '")');
          gMutex.release();
          callback(null, { track_id: trackID, track: fp.track,
            artist_id: artistID, artist: artist });
        });
      }
    });
  });
}
