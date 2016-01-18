exports.CommandHandler = function(db) {
  return {
    // format: { "command" : "query", "device": "device-id", "after": 0 }
    "onCommand": function(command, connection) {
      if (command.command = "query") {
        db.serialize(function() {
          if (command.after != undefined && command.device == undefined) {
            connection.sendUTF(JSON.stringify({
              "error": "parameter 'device' is mandatory with 'after'"
            }));
          }
          var sql = "select * from raw_events";
          var params = [];
          if (command.device != undefined) {
            sql = sql + " where device_id = ?";
            params.push(command.device);
          }
          if (command.after != undefined) {
            sql = sql + " and serial_no > ?";
            params.push(command.after);
          }
          db.all(sql, params, function(err, rows) {
            if (err) {
              console.log(err);
              connection.sendUTF(JSON.stringify({
                "error": "parameter 'device' is mandatory with 'after'"
              }));
              return;
            }
            rows.forEach(function(row) {
              var event = {
                "coreid": row.device_id,
                "published_at": row.published_at,
                "name": "brunelle/stored",
                "data": row.raw_data
              };
              connection.sendUTF(JSON.stringify(event));
            });
          });
        });
      } else {
        connection.sendUTF(JSON.stringify({
          "error": "command not supported: " + command.command
        }));
      }
    }
  };
}
