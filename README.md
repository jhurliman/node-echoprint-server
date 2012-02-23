# node-echoprint-server #

A node.js music identification server that is compatible with the 
[Echoprint](http://echoprint.me/) music fingerprinting client. This server is 
based on the original 
[echoprint-server](https://github.com/echonest/echoprint-server) but attempts 
to improve on ease of installation, speed, matching accuracy, and ease of 
development/debugging.

## Dependencies ##

* [node.js](http://nodejs.org/) - Tested with 0.6.10
* [MySQL](http://mysql.com/) - Tested with 5.5.20

To generate audio fingerprints you will need the 
[echoprint-codegen](https://github.com/echonest/echoprint-codegen) client.

## Installation ##

Clone this repository, enter the `node-echoprint-server` directory and run 
`npm install` to fetch the required dependencies. Import the `mysql.sql` file 
into your MySQL database. Next, copy `config.local.js.orig` to 
`config.local.js` and modify it to suit your environment. Make sure the 
database settings point to the MySQL database you just imported. Finally, run 
`node index.js` to start the server.

## Usage ##

The server will listen on the port configured in `config.local.js` and exposes 
two API endpoints.

### POST /ingest

Adds a new music fingerprint to the database if the given fingerprint is 
unique, otherwise the existing track information is returned.

Required fields:
 * `code` - The code string output by echoprint-codegen
 * `version` - metadata.version field output by echoprint-codegen
 * `length` - Length in seconds of the track. duration field output by 
   echoprint-codegen

Optional fields:
 * `track` - Name of the track
 * `artist` - Track artist

The response is a JSON object containing `track_id`, `track`, `artist_id`, 
`artist` on success or `error` string on failure.
 
### GET /query?code=...&version=...

Queries for a track matching the given fingerprint. `code` and `version` 
query parameters are both required. The response is a JSON object 
containing a `success` boolean, `status` string, `match` object on 
successful match, or `error` string if something went wrong.

Additionally, there is a /debug endpoint that can be visited in a browser and 
provides a human-friendly way of querying for a match and observing results. 
Here is a screenshot of the debug interface in action:

![](http://github.com/jhurliman/node-echoprint-server/raw/master/docs/node-echoprint-debug01.png)

## Sponsors ##

This server has been released as open source by 
[John Hurliman](http://jhurliman.org/) at [cull.tv](http://cull.tv).

## License ##

Uses code from 
[echoprint-server](https://github.com/echonest/echoprint-server), which is 
released by The Echo Nest Corporation under the 
[Apache 2 License](https://github.com/echonest/echoprint-server/blob/master/LICENSE).

(The MIT License)

Copyright (c) 2012 Cull TV, Inc. &lt;jhurliman@cull.tv&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
