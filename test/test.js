const assert = require('assert');
const eventmodule = require('../event.js');

var db = {
  "serialize": function() {}
}

const events = eventmodule.EventDatabase(db);

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
  events.handleEvent(event, db);
}

exports['test handleEvent#replay'] = function() {
  var event = {
    "data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588, \"name\": \"BLAH/Distance\"}",
    "ttl": "60",
    "published_at": "2016-01-17T17:17:18.370Z",
    "coreid": "1f003f000747343337373738",
    "name": "brunelle/replay/sonde/BLAH/Distance"
  };
  events.handleEvent(event, db);
}

exports['test handleEvent#started'] = function() {
  var event = {
    "data": "started ",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:53.757Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/flash/status"
  };
  events.handleEvent(event);
}

exports['test handleEvent#failed'] = function() {
  var event = {
    "data": "failed ",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:58.759Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/flash/status"
  };
  events.handleEvent(event);
}

exports['test handleEvent#online'] = function() {
  var event = {
    "data": "online",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:58.758Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/status"
  };
  events.handleEvent(event);
}

exports['test onEvent'] = function() {
  var event = {
    "data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588, \"eName\": \"BLAH/Distance\"}",
    "ttl": "60",
    "published_at": "2016-01-17T17:17:18.370Z",
    "coreid": "1f003f000747343337373738",
    "name": "brunelle/live/sonde/BLAH/Distance"
  };
  events.onEvent(function(evt) {
    console.log("onEvent called: " + JSON.stringify(evt));
  });
  events.handleEvent(event);
}
