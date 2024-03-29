const chalk = require("chalk");
const Promise = require("promise");

exports.EventDatabase = function (db) {
    var self = this;
    self.listeners = [];
    self.deviceAttributes = {};
    self.devString = function (deviceId) {
        var name = self.deviceAttributes[deviceId]
            ? self.deviceAttributes[deviceId].name
            : "?";
        return name + " (" + deviceId + ")";
    };
    self.setAttributes = function (deviceId, dev) {
        self.deviceAttributes[deviceId] = dev;
    };

    this.handleEvent = function (event) {
        // var publishDate = new Date(event.published_at);
        const publishDate = event.published_at;
        if (event.data.indexOf("noSerie", 0) == -1) {
            console.warn("Unknown event: " + JSON.stringify(event));
            return;
        }
        try {
            var data = JSON.parse(event.data);
            self.containsEvent(event.coreid, data.generation, data.noSerie)
                .then(function (contained) {
                    if (contained) {
                        if (event.upstream) {
                            console.log(
                                chalk.gray(
                                    "Ignored duplicate upstream event: %s at %s,%s %s"
                                ),
                                self.devString(event.coreid),
                                data.generation,
                                data.noSerie,
                                event.data
                            );
                        } else if (data.replay == 0) {
                            console.log(
                                chalk.yellow(
                                    "Dropped duplicate with non-replay attribute: %s at %s,%s %s (POSSIBLE DATA LOSS)"
                                ),
                                self.devString(event.coreid),
                                data.generation,
                                data.noSerie,
                                event.data
                            );
                        } else {
                            console.log(
                                chalk.gray("Ignored duplicate: %s at %s,%s %s"),
                                self.devString(event.coreid),
                                data.generation,
                                data.noSerie,
                                event.data
                            );
                        }
                    } else {
                        // TODO If this is a new generation ID and it is greater than zero, request a replay of that generation from zero.
                        self.insertAndNotify(
                            event,
                            event.coreid,
                            data.generation,
                            data.noSerie,
                            publishDate,
                            event.data
                        );
                    }
                })
                .catch(function (err) {
                    console.error(err);
                });
        } catch (exception) {
            console.warn(
                "Failed to inspect event from %s. Storing potentially recoverable event: %s / %s",
                self.devString(event.coreid),
                JSON.stringify(event),
                exception
            );
            self.insertAndNotify(
                event,
                event.coreid,
                undefined,
                undefined,
                publishDate,
                event.data
            );
        }
    };

    this.insertAndNotify = function (
        event,
        deviceId,
        generationId,
        serialNo,
        publishDate,
        data
    ) {
        self.insertEvent(
            event.coreid,
            generationId,
            serialNo,
            publishDate,
            data
        );
        self.listeners.forEach(function (listener) {
            listener.call(listener, event);
        });
    };

    this.insertEvent = function (
        deviceId,
        generationId,
        serialNo,
        publishDate,
        rawData
    ) {
        var sql =
            "INSERT INTO raw_events (device_id, published_at, generation_id, serial_no, raw_data) VALUES (?, ?, ?, ?, ?)";
        var prepared = db.prepare(sql);
        return new Promise(function (complete, reject) {
            var params = [
                deviceId,
                publishDate,
                generationId,
                serialNo,
                rawData,
            ];
            console.log(
                "Event: %s at %s,%s %s",
                self.devString(deviceId),
                generationId,
                serialNo,
                rawData
            );
            try {
                prepared.run(params);
                complete();
            } catch (err) {
                reject(err);
                console.error("insertEvent Error: ", err);
            }
        });
    };

    this.containsEvent = function (deviceId, generationId, serialNo) {
        const sql =
            "select 1 from raw_events where device_id = ? and generation_id = ? and serial_no = ?";
        var prepared = db.prepare(sql);
        return new Promise(function (complete, reject) {
            try {
                const params = [deviceId, generationId, serialNo];
                const row = prepared.get(params);
                complete(typeof row !== "undefined");
            } catch (err) {
                reject(err);
                console.error("containsEvent Error: ", err);
            }
        });
    };

    this.onEvent = function (listener) {
        this.listeners.push(listener);
    };
};
