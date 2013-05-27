/**
 * MySQL database backend. An alternative database backend can be created
 * by implementing all of the methods exported by this module
 */

var fs = require('fs');
var mysql = require('mysql');
var temp = require('temp');
var log = require('winston');
var config = require('../config');

exports.fpQuery = fpQuery;
exports.getTrack = getTrack;
exports.getTrackByName = getTrackByName;
exports.getArtist = getArtist;
exports.getArtistByName = getArtistByName;
exports.addTrack = addTrack;
exports.addArtist = addArtist;
exports.updateTrack = updateTrack;
exports.updateArtist = updateArtist;
exports.disconnect = disconnect;

// Initialize the MySQL connection
var client = mysql.createConnection({
  user: config.db_user,
  password: config.db_pass,
  database: config.db_database,
  host: config.db_host
});
client.connect();

/**
 *
 */
function fpQuery(fp, rows, callback) {
  var fpCodesStr = fp.codes.join(',');
  
  // Get the top N matching tracks sorted by score (number of matched codes)
  var sql = 'SELECT track_id,COUNT(track_id) AS score ' +
    'FROM codes ' +
    'WHERE code IN (' + fpCodesStr + ') ' +
    'GROUP BY track_id ' +
    'ORDER BY score DESC ' +
    'LIMIT ' + rows;
  client.query(sql, [], function(err, matches) {
    if (err) return callback(err, null);
    if (!matches || !matches.length) return callback(null, []);
    
    var trackIDs = new Array(matches.length);
    var trackIDMap = {};
    for (var i = 0; i < matches.length; i++) {
      var trackID = matches[i].track_id;
      trackIDs[i] = trackID;
      trackIDMap[trackID] = i;
    }
    var trackIDsStr = trackIDs.join('","');
    
    // Get all of the matching codes and their offsets for the top N matching
    // tracks
    sql = 'SELECT code,time,track_id ' +
      'FROM codes ' +
      'WHERE code IN (' + fpCodesStr + ') ' +
      'AND track_id IN ("' + trackIDsStr + '")';
    client.query(sql, [], function(err, codeMatches) {
      if (err) return callback(err, null);
      
      for (var i = 0; i < codeMatches.length; i++) {
        var codeMatch = codeMatches[i];
        var idx = trackIDMap[codeMatch.track_id];
        if (idx === undefined) continue;
        
        var match = matches[idx];
        if (!match.codes) {
          match.codes = [];
          match.times = [];
        }
        match.codes.push(codeMatch.code);
        match.times.push(codeMatch.time);
      }
      
      callback(null, matches);
    });
  });
}

function getTrack(trackID, callback) {
  var sql = 'SELECT tracks.*,artists.name AS artist_name ' +
    'FROM tracks,artists ' +
    'WHERE tracks.id=? ' +
    'AND artists.id=artist_id';
  client.query(sql, [trackID], function(err, tracks) {
    if (err) return callback(err, null);
    if (tracks.length === 1)
      return callback(null, tracks[0]);
    else
      return callback(null, null);
  });
}

function getTrackByName(track, artistID, callback) {
  var sql = 'SELECT tracks.*,artists.name AS artist_name ' +
    'FROM tracks,artists ' +
    'WHERE tracks.name LIKE ? ' +
    'AND artist_id=? ' +
    'AND artists.id=artist_id';
  client.query(sql, [track, artistID], function(err, tracks) {
    if (err) return callback(err, null);
    if (tracks.length > 0)
      return callback(null, tracks[0]);
    else
      return callback(null, null);
  });
}

function getArtist(artistID, callback) {
  var sql = 'SELECT * FROM artists WHERE id=?';
  client.query(sql, [artistID], function(err, artists) {
    if (err) return callback(err, null);
    if (artists.length === 1) {
      artists[0].artist_id = artists[0].id;
      return callback(null, artists[0]);
    } else {
      return callback(null, null);
    }
  });
}

function getArtistByName(artistName, callback) {
  var sql = 'SELECT * FROM artists WHERE name LIKE ?';
  client.query(sql, [artistName], function(err, artists) {
    if (err) return callback(err, null);
    if (artists.length > 0) {
      artists[0].artist_id = artists[0].id;
      return callback(null, artists[0]);
    } else {
      return callback(null, null);
    }
  });
}

function addTrack(artistID, fp, callback) {
  var length = fp.length;
  if (typeof length === 'string')
    length = parseInt(length, 10);
  
  // Sanity checks
  if (!artistID)
    return callback('Attempted to add track with missing artistID', null);
  if (isNaN(length) || !length)
    return callback('Attempted to add track with invalid duration "' + length + '"', null);
  if (!fp.codever)
    return callback ('Attempted to add track with missing code version (codever field)', null);
  
  var sql = 'INSERT INTO tracks ' +
    '(codever,name,artist_id,length,import_date) ' +
    'VALUES (?,?,?,?,NOW())';
  client.query(sql, [fp.codever, fp.track, artistID, length],
    function(err, info)
  {
    if (err) return callback(err, null);
    if (info.affectedRows !== 1) return callback('Track insert failed', null);
    
    var trackID = info.insertId;
    var tempName = temp.path({ prefix: 'echoprint-' + trackID, suffix: '.csv' });
    
    // Write out the codes to a file for bulk insertion into MySQL
    log.debug('Writing ' + fp.codes.length + ' codes to temporary file ' + tempName);
    writeCodesToFile(tempName, fp, trackID, function(err) {
      if (err) return callback(err, null);
      
      // Bulk insert the codes
      log.debug('Bulk inserting ' + fp.codes.length + ' codes for track ' + trackID);
      sql = 'LOAD DATA LOCAL INFILE ? IGNORE INTO TABLE codes';
      client.query(sql, [tempName], function(err, info) {
        // Remove the temporary file
        log.debug('Removing temporary file ' + tempName);
        fs.unlink(tempName, function(err2) {
          if (!err) err = err2;
          callback(err, trackID);
        });
      });
    });
  });
}

function writeCodesToFile(filename, fp, trackID, callback) {
  var i = 0;
  var keepWriting = function() {
    var success = true;
    while (success && i < fp.codes.length) {
      success = file.write(fp.codes[i]+'\t'+fp.times[i]+'\t'+trackID+'\n');
      i++;
    }
    if (i === fp.codes.length)
      file.end();
  };
  
  var file = fs.createWriteStream(filename);
  file.on('drain', keepWriting);
  file.on('error', callback);
  file.on('close', callback);
  
  keepWriting();
}

function addArtist(name, callback) {
  var sql = 'INSERT INTO artists (name) VALUES (?)';
  client.query(sql, [name], function(err, info) {
    if (err) return callback(err, null);
    callback(null, info.insertId);
  });
}

function updateTrack(trackID, name, artistID, callback) {
  var sql = 'UPDATE tracks SET name=?, artist_id=? WHERE id=?';
  client.query(sql, [name, artistID, trackID], function(err, info) {
    if (err) return callback(err, null);
    callback(null, info.affectedRows === 1 ? true : false);
  });
}

function updateArtist(artistID, name, callback) {
  var sql = 'UPDATE artists SET name=? WHERE id=?';
  client.query(sql, [name, artistID], function(err, info) {
    if (err) return callback(err, null);
    callback(null, info.affectedRows === 1 ? true : false);
  });
}

function disconnect(callback) {
  client.end(callback);
}
