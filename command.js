exports.CommandHandler = function (db, blacklist) {
    function isBlacklisted(row) {
        const blacklisted = blacklist.find(function (black) {
            return (
                (!black.device || black.device === row.device_id) &&
                (!black.timestampUntil ||
                    black.timestampUntil < row.published_at)
            );
        });
        if (blacklisted) {
            // console.log("Blacklisted row", row.device_id, row.published_at, blacklisted.reason);
            return true;
        }
    }

    function handleQuery(command, connection) {
        const hasDeviceParam = typeof command.device !== "undefined";
        const hasGenerationParam = typeof command.generation !== "undefined";
        const hasAfterParam = typeof command.after !== "undefined";
        if (hasAfterParam && !hasDeviceParam) {
            connection.send(
                JSON.stringify({
                    error: "parameter 'device' is mandatory with 'after' parameter",
                })
            );
        }
        if (hasAfterParam && !hasGenerationParam) {
            connection.send(
                JSON.stringify({
                    error: "parameter 'generation' is mandatory with 'after' parameter",
                })
            );
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
        const iterator = db.prepare(sql).iterate(params);
        command.sent = 0;

        function doneSending() {
            console.log("Completed.", command);
            connection.send(
                JSON.stringify({
                    name: "collector/querycomplete",
                    data: {
                        command: command,
                        sql: sql,
                    },
                })
            );
        }

        function sendNext() {
            const elem = iterator.next();
            if (elem.done) {
                doneSending();
                db.close();
                return;
            }
            const row = elem.value;
            if (isBlacklisted(row)) {
                // Ignore
                sendNext();
            } else if (
                row.published_at === null ||
                row.generation_id === null
            ) {
                // console.log("Skipping invalid row", row);
                sendNext();
            } else {
                try {
                    const data = JSON.parse(row.raw_data);
                    data.generation = row.generation_id;
                    data.noSerie = row.serial_no;
                    const event = {
                        coreid: row.device_id,
                        published_at: new Date(row.published_at),
                        name: data.eName,
                        data: JSON.stringify(data),
                        // "context": {command: command, sql: sql, row: row}
                    };
                    command.sent += 1;
                    connection.send(JSON.stringify(event), sendNext);
                    // catch error and skip in case the JSON contains errors
                } catch (error) {
                    console.log("JSON: ", row.raw_data);
                    console.log("Error", error);
                    sendNext();
                }
            }
        }

        sendNext();
    }

    return {
        // format: { "command" : "query", "device": "device-id", "generation" : 0, "after": 0 }
        onCommand: function (command, connection) {
            if (command.command === "subscribe") {
                connection.subscribed = true;
            } else if (command.command === "query") {
                handleQuery(command, connection);
            } else {
                connection.send(
                    JSON.stringify({
                        name: "collector/error",
                        data: {
                            message: "command not supported",
                            command: command,
                        },
                    })
                );
            }
        },
    };
};
