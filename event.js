exports.EventDatabase = function(db) {
  return {
    "handleEvent": function(event) {
      published_at = new Date(event.published_at);
      if (event.name.lastIndexOf("spark/", 0) != -1) {
        console.warn("Spark event: " + JSON.stringify(event));
        return
      }
      var data = JSON.parse(event.data);
      if (event.name.lastIndexOf("brunelle/replay/", 0) != -1) {
        console.log("Got Replay event: " + JSON.stringify(event));
        if (this.containsEvent(event.coreid, data.noSerie)) {
          console.log("Ignoring duplicate event from replay: " + JSON.stringify(event));
          return
        }
      }
      this.insertEvent(event.coreid, data.noSerie, data.eTime, published_at, event.name, data.eData);
    },
    "insertEvent": function(device_id, serial_no, event_time, published_at, event_name, raw_data) {
      console.log("Got: " + [device_id, serial_no, event_time, published_at, event_name, raw_data]);
      var sql = "INSERT INTO raw_events (device_id, published_at, event_name, raw_data, serial_no) VALUES (?, ?, ?, ?, ?)";
      db.serialize(function() {
        db.run(sql, [device_id, published_at, event_name, raw_data, serial_no]);
      });
    },
    "containsEvent": function(device_id, serial_no) {
      return true;
    }
  }
}
