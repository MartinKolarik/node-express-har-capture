/* Capture data for a bunch of simple requests
 *
 * options:
 *
 * - `mapRequestToName`: function that maps a `req` to a filename that will end
 *   up on disk
 * - `harOutputDir`: Where to put the HAR-files
 *
 * TODO:
 * - Other output directories? (Don't use file-system at all?)
 * - Filter what we record up front?
 */
var fs = require('fs'),
    path = require('path');

module.exports = function harCaptureMiddlewareSetup(options) {
    // Extract options
    var mapRequestToName = options.mapRequestToName || function (req) {
        return req.ip;
    };
    var saveRequestBody = !!options.saveRequestBody;
    var harOutputDir = options.harOutputDir || process.cwd();
    var filterFunction = options.filter || function (req) {
        return true;
    };

    return function harCaptureMiddleware(req, res, next) {
        // Filter out stuff we don't want to run
        if (!filterFunction(req)) { return next(); }

        var startTime = Date.now(),
            outputName = mapRequestToName(req);

        // Listen in on body parsing
        // NOTE: We do not resume the stream, as it would make actual parsers
        // miss out on the data. On the down-side, it doesn't capture a body
        // when the body isn't used later.
        var requestBodySize = 0,
            requestBody = [];

        req.on('data', function (chunck) {
            requestBodySize += chunck.length;
            if (saveRequestBody) {
                requestBody.push(chunck);
            }
        });
        req.on('end', function (chunck) {
            if (chunck) {
                requestBodySize += chunck.length;
                if (saveRequestBody) {
                    requestBody.push(chunck);
                }
            }

            if (requestBody.length < 0) {
                requestBody = "";
                return;
            }

            if (Buffer.isBuffer(requestBody[0])) {
                requestBody = Buffer.concat(requestBody).encode('base64');
            } else {
                requestBody = requestBody.join("");
            }
        });

        // Shadow the 'end' request
        var end = res.end;
        res.end = function () {
            var endTime = Date.now(),
                deltaTime = endTime - startTime;
            // Call the real 'end'
            end.apply(res, arguments);

            // Store har-stuff...
            var data = {
                log: {
                    version: '1.1', // Version of HAR file-format
                    creator: {
                        name: 'node-express-har-capture',
                        version: '0.0.0' // TODO: Get from package.json
                        // comment: ""
                    },
                    pages: [{
                        startedDateTime: new Date(startTime).toISOString(),
                        id: 'page' + startTime,
                        title: req.url,
                        pageTimings: { onLoad: deltaTime }
                    }],
                    entries: [{
                        timings: {
                            send: -1,
                            receive: -1,
                            wait: deltaTime,
                            comment: "Server-side processing only",
                            onLoad: -1,
                        },
                        startedDateTime: new Date(startTime).toISOString(),
                        time: deltaTime,
                        request: {
                            method: req.method,
                            url: req.originalUrl,
                            httpVersion: 'HTTP/' + req.httpVersion,
                            headersSize: 0, // Filled out later
                            headers: [], // Filled out later
                            queryString: [], // TODO
                            cookies: [], // TODO
                            bodySize: requestBodySize,
                            content: {
                                size: requestBodySize,
                                text: requestBody,
                                comment: "Captured input stream"
                            }
                        },
                        response: {
                            status: res.statusCode,
                            redirectURL: req.originalUrl,
                            httpVersion: 'HTTP/' + req.httpVersion, // TODO
                            headersSize: -1,
                            statusText: 'OK', // TODO
                            headers: [],
                            cookies: [], // TODO
                            bodySize: -1, // TODO
                            content: { // TODO
                                size: -1,
                                mimeType: '',
                                compression: -1
                            },
                            timings: {
                                send: 0,
                                receive: 0,
                                wait: deltaTime,
                                comment: "Server-side processing only"
                            }
                        },
                        cache: {}, // TODO / is it optional
                        pageref: 'page' + startTime
                    }]
                }
            };

            // REQUEST DATA
            // Fix up data-stucture with iterative data from request
            // Headers
            Object.keys(req.headers).forEach(function (headerName) {
                data.log.entries[0].request.headersSize += headerName.length + 2 + req.headers[headerName].length;
                data.log.entries[0].request.headers.push({
                    name: headerName,
                    value: req.headers[headerName]
                });
            });
            // Query strings
            Object.keys(req.query).forEach(function (queryName) {
                data.log.entries[0].request.queryString.push({
                    name: queryName,
                    value: req.query[queryName]
                });
            });
            // TODO: Cookies

            // RESPONSE DATA
            // Headers
            if (res._headerSent) {
                data.log.entries[0].response.headersSize = res._header.length;
                Object.keys(res._headers).forEach(function (headerName) {
                    var realHeaderName = res._headerNames[headerName] || headerName;
                    data.log.entries[0].response.headers.push({
                        name: realHeaderName,
                        value: res._headers[headerName]
                    });
                });
            }


            // Write the data out
            fs.writeFile(
                path.join(harOutputDir, Date.now().toString() + '-' + outputName + '.har'),
                JSON.stringify(data, undefined, 2)
            );
        };

        // Continue processing the request
        next();
    };
};
