
exports.handleEvent = function(event) {
  published_at = new Date(event.published_at);
  var data = JSON.parse(event.data.replace(/'/g, '"'));
  exports.handleEventData(event.coreid, data.noSerie, data.eTime, published_at, event.name, data.eData);
}

exports.handleEventData = function(device_id, serial_no, event_time, published_at, event_name, raw_data) {
  console.log("Got: " + [device_id, serial_no, event_time, published_at, event_name, raw_data]);
}
