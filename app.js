//
// Store Spark Core devices raw events
//
var Promise = require('promise');
var http = require('https');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('raw_events.sqlite3');
var express = require('express');
var path = require('path');
const eventmodule = require('./event.js');
var accessToken = process.env.ACCESS_TOKEN;

const eventDB = eventmodule.EventDatabase(db);
const CommandHandler = require('./command.js').CommandHandler(db);

var app = express();
app.use(app.router);
app.use(express.logger());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', express.static(path.join(__dirname, 'index.html')));
app.get('/device/:id', function(req, res) {
  db.serialize(function() {
    var serial_no = req.query.since;
    db.all("select * from raw_events where device_id = ? and serial_no > ?", [req.params.id, serial_no], function(err, rows) {
      if (err) {
        console.log(err);
        return res.send(500, err);
      }
      var events = rows.map(function(row) {
        return {
          "coreid": row.device_id,
          "published_at": row.published_at,
          "name": "brunelle/stored",
          "data": row.raw_data
        };
      });
      res.setHeader("Content-Type", "text/plain");
      res.send(JSON.stringify(events));
    });
  });
});

spark.login({
  accessToken: accessToken
}).then(
  function(token) {
    console.log('Login completed. Token: ', token);
    requestReplay();
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
        console.log("Exception: " + exception + "\n" + exception.stack);
      }
    });
  },
  function(err) {
    console.log('Login failed: ', err);
  }
);

function requestReplay() {
  db.each("select device_id, max(serial_no) as serial_no from raw_events group by device_id", function(err, row) {
    if (err) {
      throw err;
    }
    console.log("Requesting replay on " + row.device_id);
    spark.getDevice(row.device_id, function(err, device) {
      device.callFunction('replay', row.serial_no + 1).then(function(err, data) {
        if (err) {
          console.error('Replay request failed:', err);
        } else {
          console.log('Replay request successful:', data);
        }
      });
    });
  });
}

var http = require('http');
var port = process.env.PORT || '3000';
app.set('port', port);
var server = http.createServer(app);

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
        CommandHandler.onCommand(command, connection);
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

server.listen(port);
console.log('Server started: http://localhost:' + port);
