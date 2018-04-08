var fs = require('fs');
var Promise = require('promise');
var readFile = Promise.denodeify(fs.readFile);
var http = require('http');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var express = require('express');
var path = require('path');
var chalk = require('chalk');
var Watchout = require('watchout')
var WebSocketClient = require('websocket').client;

const eventmodule = require('./event.js');
var config = require('./config.json');
var dbFile = config.database || 'raw_events.sqlite3';
var accessToken = config.accessToken;
var eventDB;

function devString(deviceId) {
  return eventDB.devString(deviceId);
}

function UpstreamSources(config) {

    var uri = config.collectors[0].uri;
    var connectBackoff = 500;
    var client = new WebSocketClient();
    var connection;
    var onConnectSuccess;
    var connectPromise = new Promise(function(complete, reject) {
        onConnectSuccess = complete;
    });

    return {
        connect: function () {
            console.log('Connecting upstream', uri);
            client.connect(uri, 'event-stream');
        },
        reconnect: function () {
            connectBackoff = Math.min(connectBackoff * 2, 1000 * 60);
            setTimeout(this.connect, connectBackoff);
        },
        joinOthers: function () {
            client.on('connectFailed', function (error) {
                console.log('Connect Error: ' + error.toString());
                this.reconnect();
            }.bind(this));
            client.on('connect', function (con) {
                connection = con;
                connectBackoff = 1;
                console.log('WebSocket Client Connected to: ' + uri);
                onConnectSuccess(connection);
                connection.on('error', function (error) {
                    console.log("Connection Error: " + error.toString());
                    this.reconnect();
                }.bind(this));
                connection.on('close', function () {
                    console.log('event-stream Connection Closed');
                    this.reconnect();
                }.bind(this));
                connection.on('message', function (message) {
                    if (message.type === 'utf8') {
                        console.log("Upstream: '" + message.utf8Data + "'");
                        try {
                            this.handleMessage(JSON.parse(message.utf8Data));
                        } catch (exception) {
                            console.log("Failed to handle upstream message: " + message.utf8Data, exception.stack);
                        }
                    } else {
                        console.log("Unknown upstream message type: " + message.type);
                    }
                }.bind(this));

                console.log("Requesting upstream events from all devices");
                // TODO Only request missing events (based on generation & serial gaps)
                connection.sendUTF(JSON.stringify({
                    "command": "query"
                }));
            }.bind(this));
            this.connect();
        },
        handleMessage: function (event) {
            event.upstream = true;
            eventDB.handleEvent(event);
        }.bind(this)
    };
}

function startApp(db) {
  console.log(chalk.gray("Starting application..."));
  eventDB = new eventmodule.EventDatabase(db);
  var commandHandler = require('./command.js').CommandHandler(db, config.blacklist);
  var app = createExpressApp(db);
  connectToParticleCloud(db, eventDB);
  try {
    var port = config.port || '3000';
    app.set('port', port);
    var server = http.createServer(app);
    createWebSocketServer(server, eventDB, commandHandler);
    server.listen(port);
    console.log(chalk.green('Server started: http://localhost:%s'), port);
    var upstream = new UpstreamSources(config);
    // upstream.joinOthers();
  } catch (err) {
    console.error(err);
    throw err;
  }
}

function ensureDatabase() {
  return new Promise(function(resolve, reject) {
    fs.open(dbFile, 'r', function(err, fd) {
      if (err) {
        console.log(chalk.gray("Creating database: %s"), dbFile);
        readFile('schema.sql', 'utf8').then(createDatabase).then(resolve, reject);
      } else {
        console.log(chalk.gray("Using existing database: %s"), dbFile);
        resolve(new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE));
      }
    });
  });
}

function createDatabase(schema) {
  return new Promise(function(resolve, reject) {
    var db = new sqlite3.Database(dbFile);
    db.serialize(function() {
      db.run(schema, function(err) {
        if (err != null) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });
  });
}

function createExpressApp() {
  var app = express();
  app.use(app.router);
  app.use(express.logger());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/', express.static(path.join(__dirname, 'index.html')));
  app.get('/device/:id', function(req, res) {
    db.serialize(function() {
      var generationId = req.query.generation;
      var serialNo = req.query.since;
      var sql = "select * from raw_events where device_id = ? and generation_id = ? and serial_no > ?";
      var params = [req.params.id, generationId, serialNo];
      db.all(sql, params, function(err, rows) {
        if (err) {
          console.log(chalk.red(err));
          return res.send(500, err);
        }
        var events = rows.map(function(row) {
          return {
            "coreid": row.device_id,
            "published_at": row.published_at,
            "name": "collector/replay",
            "data": row.raw_data
          };
        });
        res.setHeader("Content-Type", "text/plain");
        res.send(JSON.stringify(events));
      });
    });
  });
  return app;
}

function connectToParticleCloud(db, eventDB) {
  spark.login({
    accessToken: accessToken
  }).then(
    function(token) {
      console.log(chalk.gray('Login to cloud completed. Listing devices...'));
      spark.listDevices().then(
        function(devices) {
          console.log(chalk.gray('Got %s devices from cloud.'), devices.length);
          devices.forEach(function(dev)  {
            eventDB.setAttributes(dev.id, dev);
          });
//          requestAllDeviceReplay(db);
          openStream(db, eventDB);
        },
        function(err) {
          console.log(chalk.red('List devices call failed: %s'), err);
          connectToParticleCloud();
        }
      );
    },
    function(err) {
      console.log(chalk.red('Login failed: %s'), err);
    }
  );
}

function openStream(db, eventDB) {
  console.log(chalk.gray('Connecting to event stream.'));
  var stream = spark.getEventStream(false, 'mine', function(event, err) {
    if (err) {
      throw err;
    }
    try {
      if (event.code == "ETIMEDOUT") {
        console.error(chalk.red(Date() + " Timeout error"));
      } else {
        eventDB.handleEvent(event);
      }
      watchdog.reset();
    } catch (exception) {
      console.error(chalk.red("Exception: " + exception + "\n" + exception.stack));
      connectToParticleCloud();
    }
  });
  var streamTimeout = config.streamTimeout || 300 * 1000;
  var watchdog = new Watchout(streamTimeout, function() {
    console.log(chalk.yellow(Date() + ' No events received in ' + streamTimeout + 'ms. Re-opening event stream.'))
    stream.abort();
  });
  stream.on('end', function() {
    console.error(chalk.red(Date() + " Stream ended! Will re-open."));
    setTimeout(function() {
      requestAllDeviceReplay(db);
      openStream(db, eventDB);
    }, 1000);
  });
}

function requestAllDeviceReplay(db) {
  var sql = "select raw_events.device_id as device_id, raw_events.generation_id as generation_id, max(raw_events.serial_no) as serial_no from raw_events, (select device_id, max(generation_id) as generation_id from raw_events group by device_id) as gens where raw_events.device_id = gens.device_id and raw_events.generation_id = gens.generation_id group by raw_events.device_id";
  db.each(sql, function(err, row) {
    if (err) {
      throw err;
    } else if (row.device_id == null) {
      // Ignoring empty row returned by sqlite aggregate function on empty result.
      console.log(chalk.gray("No devices to request a replay from."));
    } else if (typeof row.generation_id === "undefined") {
      console.error(chalk.red("Got undefined generation for device %s. Don't know what to request. Waiting for new events. POSSIBLE DATA LOSS!"), row.device_id);
    } else {
      requestDeviceReplay(row.device_id, row.generation_id, row.serial_no);
    }
  });
}

function requestDeviceReplay(deviceId, generationId, serialNo) {
  console.log(chalk.gray("Requesting replay on %s at %s,%s"), devString(deviceId), generationId, serialNo);
  spark.getDevice(deviceId, function(err, device) {

    if (device != null){
      device.callFunction('replay', "" + serialNo + ", " + generationId, function(err, data) {
        // Return codes:
        //   0  Success
        //  -1  Failure
        //  -2  A replay is already in progress
        // -99  Invalid generation ID
        if (err) {
          console.error(chalk.red("Replay request failed: '%s' on %s at %s,%s with data: %s. EVENTS MAY BE LOST! Ensure the device is online, then restart the collector to request a new replay."), err, devString(deviceId), generationId, serialNo, data);
        } else {
          if (data.return_value == 0) {
            console.log(chalk.green('Replay request on %s successful.'), devString(deviceId));
          } else {
            console.log(chalk.yellow('Replay request refused by %s at %s,%s with code %s. EVENTS MAY BE LOST! Waiting for events.'), devString(deviceId), generationId, serialNo, data.return_value);
          }
        }
      });
    }

  });
}

function createWebSocketServer(server, eventDB, commandHandler) {
  var WebSocketServer = require('websocket').server;
  var wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
  });
  var connectedClients = [];

  function originIsAllowed(origin) {
    // put logic here to detect whether the specified origin is allowed.
    return true;
  }

  wsServer.on('request', function(request) {
    try {
      if (!originIsAllowed(request.origin)) {
        // Make sure we only accept requests from an allowed origin
        request.reject();
        console.log(chalk.yellow((new Date()) + ' Connection from origin ' + request.origin + ' rejected.'));
        return;
      }
      var connection = request.accept('event-stream', request.origin);
      connectedClients.push(connection);
      console.log(chalk.gray((new Date()) + ' Connection accepted from ' + connection.remoteAddress + '. Connections: ' + connectedClients.length));
      connection.on('message', function(message) {
        if (message.type === 'utf8') {
          console.log(chalk.gray('Received Message: %s'), message.utf8Data);
          var command = JSON.parse(message.utf8Data);
          commandHandler.onCommand(command, connection);
        }
      });
      connection.on('close', function(reasonCode, description) {
        connectedClients.splice(connectedClients.indexOf(connection), 1);
        console.log(chalk.gray((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected. Connections: ' + connectedClients.length));
      });
    } catch (exception) {
      console.error(chalk.red(exception));
    }
  });
  eventDB.onEvent(function(event) {
    connectedClients.forEach(function(connection) {
        if (connection.subscribed) {
            connection.sendUTF(JSON.stringify(event));
        }
    });
  });
}

ensureDatabase().then(startApp).catch(function(err) {
  console.error(chalk.red(err));
});
