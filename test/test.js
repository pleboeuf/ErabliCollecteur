const assert = require('assert');

var db = {
  "serialize": function(callback) {
    callback.call(this);
  },
  "run": function(sql, params) {
    console.log("Running: %s %s", sql, params);
  },
  "get": function(sql, params, callback) {
    console.log("Getting: %s %s", sql, params);
  },
  "all": function(sql, params, callback) {
    console.log("Query: " + sql + " [" + params + "]");
    var row = {
      "device_id": "12345",
      "published_at": new Date(),
      "raw_data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588, \"name\": \"BLAH/Distance\"}",
      "serial_no": 1000
    };
    callback.call(this, null, [row]);
  }
}

const EventDatabase = require('../event.js').EventDatabase;
const CommandHandler = require('../command.js').CommandHandler(db);
var database = new EventDatabase(db);

exports['test String#length'] = function() {
  assert.equal(6, 'foobar'.length);
};

exports['test handleEvent#normal'] = function() {
  var event = {
    "data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588, \"name\": \"BLAH/Distance\"}",
    "ttl": "60",
    "published_at": "2016-01-17T17:17:18.370Z",
    "coreid": "1f003f000747343337373738",
    "name": "brunelle/live/sonde/BLAH/Distance"
  };
  database.handleEvent(event, db);
}

exports['test handleEvent#replay'] = function() {
  var event = {
    "data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588, \"name\": \"BLAH/Distance\"}",
    "ttl": "60",
    "published_at": "2016-01-17T17:17:18.370Z",
    "coreid": "1f003f000747343337373738",
    "name": "brunelle/replay/sonde/BLAH/Distance"
  };
  database.handleEvent(event, db);
}

exports['test handleEvent#started'] = function() {
  var event = {
    "data": "started ",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:53.757Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/flash/status"
  };
  database.handleEvent(event);
}

exports['test handleEvent#failed'] = function() {
  var event = {
    "data": "failed ",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:58.759Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/flash/status"
  };
  database.handleEvent(event);
}

exports['test handleEvent#online'] = function() {
  var event = {
    "data": "online",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:58.758Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/status"
  };
  database.handleEvent(event);
}

exports['test onEvent'] = function() {
  var event = {
    "data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588, \"eName\": \"BLAH/Distance\"}",
    "ttl": "60",
    "published_at": "2016-01-17T17:17:18.370Z",
    "coreid": "1f003f000747343337373738",
    "name": "brunelle/live/sonde/BLAH/Distance"
  };
  database.onEvent(function(evt) {
    console.log("onEvent called: " + JSON.stringify(evt));
  });
  database.handleEvent(event);
}

exports.testHandleCommand = function() {
  var connection = {
    "sendUTF": function(msg) {
      console.log("Sending" + msg);
    }
  };
  var command = {
    "command": "query",
    "device": "device-id",
    "generation": 0,
    "after": 0
  };
  CommandHandler.onCommand(command, connection);
}

// TODO Migrate to Mocha
// TODO Actually perform assertions!
// TODO Test sending replay request.
