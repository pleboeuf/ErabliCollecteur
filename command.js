exports.CommandHandler = function(db) {
  return {
    // format: { "command" : "query", "device": "device-id", "generation" : 0, "after": 0 }
    "onCommand": function(command, connection) {
      if (command.command = "query") {
        db.serialize(function() {
          var hasDeviceParam = (typeof command.device !== "undefined");
          var hasGenerationParam = (typeof command.generation !== "undefined");
          var hasAfterParam = (typeof command.after !== "undefined");
          if (hasAfterParam && !hasDeviceParam) {
            connection.sendUTF(JSON.stringify({
              "error": "parameter 'device' is mandatory with 'after' parameter"
            }));
          }
          if (hasAfterParam && !hasGenerationParam) {
            connection.sendUTF(JSON.stringify({
              "error": "parameter 'generation' is mandatory with 'after' parameter"
            }));
          }
          var sql = "select * from raw_events";
          var params = [];
          if (hasDeviceParam) {
            sql = sql + " where device_id = ?";
            params.push(command.device);
          }
          if (hasAfterParam) {
            sql = sql + " and serial_no > ?";
            params.push(command.after);
          }
          if (hasGenerationParam) {
            sql = sql + " and generation_id = ?";
            params.push(command.generation);
          }
          db.all(sql, params, function(err, rows) {
            if (err) {
              console.log(err);
              connection.sendUTF(JSON.stringify({
                "error": err
              }));
              return;
            }
            rows.forEach(function(row) {
              var data = JSON.parse(row.raw_data);
              data.generation = row.generation_id;
              data.noSerie = row.serial_no;
              var event = {
                "coreid": row.device_id,
                "published_at": new Date(row.published_at),
                "name": "collector/query",
                "data": JSON.stringify(data)
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
