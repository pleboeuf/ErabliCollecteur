const Promise = require('promise');

exports.EventDatabase = function(db) {
  var self = this;
  this.listeners = [];
  this.handleEvent = function(event) {
    var publishDate = new Date(event.published_at);
    if (event.name.lastIndexOf("spark/", 0) != -1) {
      console.warn("Spark event: " + JSON.stringify(event));
      return
    }
    try {
      var data = JSON.parse(event.data);
      self.containsEvent(event.coreid, data.eGenTS, data.noSerie).then(function(contained) {
        if (contained) {
          console.log("Ignoring duplicate event: " + JSON.stringify(event));
        } else {
          // TODO If this is a new generation ID and it is greater than zero, request a replay of that generation from zero.
          self.insertAndNotify(event, event.coreid, data.eGenTS, data.noSerie, data.eTime, publishDate, event.data);
        }
      }).catch(function(err) {
        console.error(err);
      });
    } catch (exception) {
      console.warn("Failed to inspect event. Storing potentially recoverable event: " + JSON.stringify(event), exception);
      self.insertAndNotify(event, event.coreid, undefined, undefined, undefined, publishDate, event.data);
    }
  };
  this.insertAndNotify = function(event, deviceId, generationId, serialNo, eventTime, publishDate, data) {
    self.insertEvent(event.coreid, generationId, serialNo, eventTime, publishDate, data);
    self.listeners.forEach(function(element) {
      element.call(element, event);
    });
  };
  this.insertEvent = function(deviceId, generationId, serialNo, eventTime, publishDate, rawData) {
    return new Promise(function(complete, reject) {
      var sql = "INSERT INTO raw_events (device_id, published_at, generation_id, serial_no, raw_data) VALUES (?, ?, ?, ?, ?)";
      var params = [deviceId, publishDate, generationId, serialNo, rawData];
      console.log("Inserting: " + params);
      db.serialize(function() {
        db.run(sql, params, function(result) {
          if (result == null) {
            complete();
          } else {
            reject(result);
          }
        });
      });
    });
  };
  this.containsEvent = function(deviceId, generationId, serialNo) {
    return new Promise(function(complete, reject) {
      db.serialize(function() {
        var sql = "select 1 from raw_events where device_id = ? and generation_id = ? and serial_no = ?";
        var params = [deviceId, generationId, serialNo];
        db.get(sql, params, function(err, row) {
          if (err) {
            reject(err);
          } else {
            complete(typeof row !== "undefined");
          }
        });
      });
    });
  };
  this.onEvent = function(listener) {
    this.listeners.push(listener);
  };
}
