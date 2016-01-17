const assert = require('assert');
const eventmodule = require('../event.js');

var db = {
  "serialize": function() {}
}

exports['test String#length'] = function() {
  assert.equal(6, 'foobar'.length);
};

exports['test handleEvent#normal'] = function() {
  var event = {
    "data": "{\"noSerie\": 7872,\"eTime\": 77465494,\"eData\": 588}",
    "ttl": "60",
    "published_at": "2016-01-17T17:17:18.370Z",
    "coreid": "1f003f000747343337373738",
    "name": "Distance"
  };
  eventmodule.handleEvent(event, db);
}

exports['test handleEvent#started'] = function() {
  var event = {
    "data": "started ",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:53.757Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/flash/status"
  };
  eventmodule.handleEvent(event, db);
}

exports['test handleEvent#failed'] = function() {
  var event = {
    "data": "failed ",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:58.759Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/flash/status"
  };
  eventmodule.handleEvent(event, db);
}

exports['test handleEvent#online'] = function() {
  var event = {
    "data": "online",
    "ttl": "60",
    "published_at": "2016-01-17T18:34:58.758Z",
    "coreid": "3a0037000c47343233323032",
    "name": "spark/status"
  };
  eventmodule.handleEvent(event, db);
}
