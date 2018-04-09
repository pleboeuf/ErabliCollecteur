exports.CommandHandler = function (db, blacklist) {
  function isBlacklisted(row) {
    const blacklisted = blacklist.find(function (black) {
      return (
        (!black.device || black.device === row.device_id) &&
        (!black.timestampUntil || black.timestampUntil < row.published_at)
      );
    });
    if (blacklisted) {
      // console.log("Blacklisted row", row.device_id, row.published_at, blacklisted.reason);
      return true;
    }
  }

  function sendRow(row, connection, context) {
    try {
      if (isBlacklisted(row)) {
        return;
      }
      if (row.published_at === null || row.generation_id === null) {
        // console.log("Skipping invalid row", row);
        return;
      }
      const data = JSON.parse(row.raw_data);
      data.generation = row.generation_id;
      data.noSerie = row.serial_no;
      const event = {
        "coreid": row.device_id,
        "published_at": new Date(row.published_at),
        "name": data.eName,
        "data": JSON.stringify(data),
        "context": context
      };
      connection.sendUTF(JSON.stringify(event));
    } catch (error) {
      console.error("Error replaying event: " + error, row);
      connection.sendUTF(JSON.stringify({
        name: "collector/error",
        data: {
          message: "Error replaying event",
          error: error,
          command: command,
          sql: sql,
          row: row
        }
      }));
    }
  }

  return {
    // format: { "command" : "query", "device": "device-id", "generation" : 0, "after": 0 }
    "onCommand": function (command, connection) {
      if (command.command === "subscribe") {
        connection.subscribed = true;
      } else if (command.command === "query") {
        const hasDeviceParam = (typeof command.device !== "undefined");
        const hasGenerationParam = (typeof command.generation !== "undefined");
        const hasAfterParam = (typeof command.after !== "undefined");
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
        sql = sql + " order by generation_id, serial_no";
        // TODO Abort query when connection closes.
        for (var row of db.prepare(sql).iterate(params)) {
          sendRow(row, connection, {command: command, sql: sql, row: row});
        }
        connection.sendUTF(JSON.stringify({
          name: "collector/querycomplete",
          data: {
            command: command,
            sql: sql
          }
        }));
      } else {
        connection.sendUTF(JSON.stringify({
          name: "collector/error",
          data: {
            message: "command not supported",
            command: command
          }
        }));
      }
    }
  };
};
