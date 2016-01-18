exports.EventDatabase = function(db) {
  return {
    "listeners": [],
    "handleEvent": function(event) {
      published_at = new Date(event.published_at);
      if (event.name.lastIndexOf("spark/", 0) != -1) {
        console.warn("Spark event: " + JSON.stringify(event));
        return
      }
      var event_serial;
      var event_time;
      try {
        var data = JSON.parse(event.data);
        event_serial = data.noSerie;
        event_time = data.eTime;
        if (event.name.lastIndexOf("brunelle/replay/", 0) != -1) {
          console.log("Got Replay event: " + JSON.stringify(event));
          if (this.containsEvent(event.coreid, data.noSerie)) {
            console.log("Ignoring duplicate event from replay: " + JSON.stringify(event));
            return
          }
        }
      } catch (exception) {
        console.warn("Failed to inspect event. Storing invariantly: " + JSON.stringify(event), exception);
      }
      this.insertEvent(event.coreid, event_serial, event_time, published_at, event.data);
      this.listeners.forEach(function(element, index, array) {
        element.call(element, event);
      });
    },
    "insertEvent": function(device_id, serial_no, event_time, published_at, raw_data) {
      console.log("Got: " + [device_id, serial_no, event_time, published_at, raw_data]);
      var sql = "INSERT INTO raw_events (device_id, published_at, raw_data, serial_no) VALUES (?, ?, ?, ?)";
      db.serialize(function() {
        db.run(sql, [device_id, published_at, raw_data, serial_no]);
      });
    },
    "containsEvent": function(device_id, serial_no) {
      return true;
    },
    "onEvent": function(listener) {
      this.listeners.push(listener);
    }
  }
}
