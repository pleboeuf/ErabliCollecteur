exports.handleEvent = function(event, db) {
  published_at = new Date(event.published_at);
  if (event.name.lastIndexOf("spark/", 0) != -1) {
    console.warn("Spark event: " + JSON.stringify(event));
    return
  }
  var data = JSON.parse(event.data);
  exports.insertEvent(db, event.coreid, data.noSerie, data.eTime, published_at, event.name, data.eData);
}

exports.insertEvent = function(db, device_id, serial_no, event_time, published_at, event_name, raw_data) {
  console.log("Got: " + [device_id, serial_no, event_time, published_at, event_name, raw_data]);
  var sql = "INSERT INTO raw_events (device_id, published_at, event_name, raw_data, serial_no) VALUES (?, ?, ?, ?, ?)";
  db.serialize(function() {
    db.run(sql, [device_id, published_at, event_name, raw_data, serial_no]);
  });
}
