var fs = require('fs');
var Promise = require('promise');
var readFile = Promise.denodeify(fs.readFile);
var http = require('http');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var express = require('express');
var path = require('path');
const eventmodule = require('./event.js');
var config = require('./config.json');
var dbFile = config.database || 'raw_events.sqlite3';
var accessToken = config.accessToken;

function startApp(db) {
  console.log("Starting application...");
  var eventDB = new eventmodule.EventDatabase(db);
  var commandHandler = require('./command.js').CommandHandler(db);
  var app = createExpressApp(db);
  connectToParticleCloud(db, eventDB);
  try {
    var port = config.port || '3000';
    app.set('port', port);
    var server = http.createServer(app);
    createWebSocketServer(server, eventDB, commandHandler);
    server.listen(port);
    console.log('Server started: http://localhost:' + port);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

function ensureDatabase() {
  return new Promise(function(resolve, reject) {
    fs.open(dbFile, 'r', function(err, fd) {
      if (err) {
        console.log("Creating database:", dbFile);
        readFile('schema.sql', 'utf8').then(createDatabase).then(resolve, reject);
      } else {
        console.log("Using existing database:", dbFile);
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
          console.log(err);
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
      console.log('Login completed. Token: ', token);
      requestAllDeviceReplay(db);
      console.log('Connecting to event stream.');
      spark.getEventStream(false, 'mine', function(event, err) {
        if (err) {
          throw err;
        }
        try {
          if (event.code == "ETIMEDOUT") {
            console.error(Date() + " Timeout error");
          } else {
            eventDB.handleEvent(event);
          }
        } catch (exception) {
          console.error("Exception: " + exception + "\n" + exception.stack);
          connectToParticleCloud();
        }
      });
    },
    function(err) {
      console.log('Login failed: ', err);
    }
  );
}

function requestAllDeviceReplay(db) {
  var sql = "select raw_events.device_id as device_id, raw_events.generation_id as generation_id, max(raw_events.serial_no) as serial_no from raw_events, (select device_id, max(generation_id) as generation_id from raw_events) as gens where raw_events.device_id = gens.device_id and raw_events.generation_id = gens.generation_id";
  db.each(sql, function(err, row) {
    if (err) {
      throw err;
    } else if (row.device_id == null) {
      // Ignoring empty row returned by sqlite aggregate function on empty result.
      console.log("No devices to request a replay from.");
    } else if (typeof row.generation_id === "undefined") {
      console.error("Got undefined generation for device %s. Don't know what to request. Waiting for new events. POSSIBLE DATA LOSS!", row.device_id);
    } else {
      requestDeviceReplay(row.device_id, row.generation_id, row.serial_no);
    }
  });
}

function requestDeviceReplay(deviceId, generationId, serialNo) {
  console.log("Requesting replay on %s at %s,%s", deviceId, generationId, serialNo);
  spark.getDevice(deviceId, function(err, device) {
    device.callFunction('replay', "" + serialNo + ", " + generationId, function(err, data) {
      // Return codes:
      //   0  Success
      //  -1  Failure
      //  -2  A replay is already in progress
      // -99  Invalid generation ID
      if (err) {
        console.error("Replay request failed: '%s' on %s at %s,%s with %s. EVENTS MAY BE LOST! Ensure the device is online, then restart the collector to request a new replay.", err, deviceId, generationId, serialNo, data);
      } else {
        if (data.return_value == 0) {
          console.log('Replay request successful: ', data);
        } else {
          console.log('Replay request refused by %s at %s,%s with code %s. EVENTS MAY BE LOST! Waiting for events.', deviceId, generationId, serialNo, data.return_value);
        }
      }
    });
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
        console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
        return;
      }
      var connection = request.accept('event-stream', request.origin);
      connectedClients.push(connection);
      console.log((new Date()) + ' Connection accepted from ' + connection.remoteAddress + '. Connections: ' + connectedClients.length);
      connection.on('message', function(message) {
        if (message.type === 'utf8') {
          console.log('Received Message: ' + message.utf8Data);
          var command = JSON.parse(message.utf8Data);
          commandHandler.onCommand(command, connection);
        }
      });
      connection.on('close', function(reasonCode, description) {
        connectedClients.splice(connectedClients.indexOf(connection), 1);
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected. Connections: ' + connectedClients.length);
      });
    } catch (exception) {
      console.error(exception);
    }
  });
  eventDB.onEvent(function(event) {
    connectedClients.forEach(function(connection) {
      connection.sendUTF(JSON.stringify(event));
    });
  });
}

ensureDatabase().then(startApp).catch(function(err) {
  console.error(err);
});
