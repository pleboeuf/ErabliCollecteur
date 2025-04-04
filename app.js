require("dotenv").config();
const fs = require("fs");
const Promise = require("promise");
const readFile = Promise.denodeify(fs.readFile);
const http = require("http");
const Particle = require("particle-api-js");
const sqlite3 = require("better-sqlite3");
const express = require("express");
const path = require("path");
const chalk = require("chalk");
const Command = require("./command.js");
const WebSocket = require("ws");
const eventmodule = require("./event.js");
const config = require("./config.json");
const dbFile = config.database || "raw_events.sqlite3";
const particle = new Particle();
const password = process.env.PARTICLE_TOKEN;
const username = process.env.PARTICLE_USER;
var accessToken;
var eventDB;
const nodeArg = process.argv;

function devString(deviceId) {
    return eventDB.devString(deviceId);
}

function startApp(db) {
    console.log(chalk.gray("Starting application..."));
    eventDB = new eventmodule.EventDatabase(db);
    const app = createExpressApp(db);
    // Do not connect to Particle cloud for playbackOnly
    connectToParticleCloud(db, eventDB, nodeArg[2], nodeArg[3]);

    try {
        const port = config.port || "3000";
        app.set("port", port);
        const server = http.createServer(app);
        createWebSocketServer(server, eventDB);
        server.listen(port);
        console.log(chalk.green("Server started: http://localhost:%s"), port);
    } catch (err) {
        console.error(err);
        throw err;
    }
}

function ensureDatabase() {
    return new Promise(function (resolve, reject) {
        fs.open(dbFile, "r", function (err, fd) {
            if (err) {
                console.log(chalk.gray("Creating database: %s"), dbFile);
                readFile("schema.sql", "utf8")
                    .then(createDatabase)
                    .then(resolve, reject);
            } else {
                console.log(chalk.gray("Using existing database: %s"), dbFile);
                resolve(new sqlite3(dbFile));
            }
        });
    });
}

function createDatabase(schema) {
    return new Promise(function (resolve, reject) {
        try {
            var db = new sqlite3(dbFile);
            db.prepare(schema).run();
            resolve(db);
        } catch (err) {
            reject(err);
        }
    });
}

function createExpressApp() {
    var app = express();
    app.use(express.static(path.join(__dirname, "public")));
    app.use("/", express.static(path.join(__dirname, "index.html")));
    app.get("/device/:id", function (req, res) {
        var generationId = req.query.generation;
        var serialNo = req.query.since;
        var sql =
            "select * from raw_events where device_id = ? and generation_id = ? and serial_no > ?";
        var params = [req.params.id, generationId, serialNo];
        try {
            const rows = db.prepare(sql).all(params);
            var events = rows.map(function (row) {
                return {
                    coreid: row.device_id,
                    published_at: row.published_at,
                    name: "collector/replay",
                    data: row.raw_data,
                };
            });
            res.setHeader("Content-Type", "text/plain");
            res.send(JSON.stringify(events));
        } catch (err) {
            console.log(chalk.red(err));
            return res.send(500, err);
        }
    });
    return app;
}

function connectToParticleCloud(db, eventDB, streamOption, replayOption) {
    particle
        .login({
            username,
            password,
        })
        .then(
            function (data) {
                accessToken = data.body.access_token;
                console.log(
                    chalk.gray("Login to cloud completed. Listing devices...")
                );
                particle.listDevices({ auth: accessToken }).then(
                    function (Devices) {
                        const myDevices = Devices.body;
                        console.log(
                            chalk.gray("Got %s devices from cloud."),
                            myDevices.length
                        );
                        myDevices.forEach(function (dev) {
                            eventDB.setAttributes(dev.id, dev);
                        });
                        if (replayOption === "allDeviceReplay") {
                            requestAllDeviceReplay(db);
                        }
                        if (streamOption !== "noStream") {
                            openStream(db, eventDB);
                        }
                    },
                    function (err) {
                        console.log(
                            chalk.red("List devices call failed: %s"),
                            err
                        );
                        connectToParticleCloud();
                    }
                );
            },
            function (err) {
                console.log(chalk.red("Login failed: %s"), err);
            }
        );
}

function openStream(db, eventDB) {
    console.log(chalk.gray("Connecting to event stream."));
    const initialDelay = 1000; // 1 second
    let stream = null;
    let watchdogTimer = null;
    const watchdogTimeout = 4 * 60 * 1000; // 4 minutes in milliseconds

    function connect() {
        particle
            .getEventStream({ deviceId: "mine", auth: accessToken })
            .then(function (newStream) {
                stream = newStream;
                console.log(chalk.green("Event stream connected."));

                stream.on("event", function (event) {
                    console.log("Event: ", event);
                    if (event.code == "ETIMEDOUT") {
                        console.error(chalk.red(Date() + " Timeout error"));
                    } else {
                        eventDB.handleEvent(event);
                    }
                });

                stream.on("close", () => {
                    console.warn(chalk.yellow("Event stream closed."));
                });

                stream.on("error", (err) => {
                    console.error(chalk.red("Event stream error:"), err);
                });
            })
            .catch(function (err) {
                console.error(chalk.red("Stream failed: %s"), err);
            });
    }

    connect(); // Initial connection attempt
}

function requestAllDeviceReplay(db) {
    var sql =
        "select raw_events.device_id as device_id, raw_events.generation_id as generation_id, max(raw_events.serial_no) as serial_no from raw_events, (select device_id, max(generation_id) as generation_id from raw_events group by device_id) as gens where raw_events.device_id = gens.device_id and raw_events.generation_id = gens.generation_id group by raw_events.device_id";
    console.log(chalk.blue("Requesting playback!!!"));
    for (const row of db.prepare(sql).iterate()) {
        try {
            if (row.device_id == null) {
                // Ignoring empty row returned by sqlite aggregate function on empty result.
                console.log(chalk.gray("No devices to request a replay from."));
            } else if (typeof row.generation_id === "undefined") {
                console.error(
                    chalk.red(
                        "Got undefined generation for device %s. Don't know what to request. Waiting for new events. POSSIBLE DATA LOSS!"
                    ),
                    row.device_id
                );
            } else {
                requestDeviceReplay(
                    row.device_id,
                    row.generation_id,
                    row.serial_no
                );
            }
        } catch (err) {
            throw err;
        }
    }
}

// function requestAllSeasonReplay(db) {
//     var sql = "select raw_events.device_id as device_id, raw_events.generation_id as generation_id, min(raw_events.serial_no) as serial_no from raw_events, (select device_id, min(generation_id) as generation_id from raw_events group by device_id) as gens where raw_events.device_id = gens.device_id and raw_events.generation_id = gens.generation_id group by raw_events.device_id";
//     console.log(chalk.blue('Requesting playback!!!'));
//     for (const row of db.prepare(sql).iterate()) {
//         try {
//             if (row.device_id == null) {
//                 // Ignoring empty row returned by sqlite aggregate function on empty result.
//                 console.log(chalk.gray("No devices to request a replay from."));
//             } else if (typeof row.generation_id === "undefined") {
//                 console.error(chalk.red("Got undefined generation for device %s. Don't know what to request. Waiting for new events. POSSIBLE DATA LOSS!"), row.device_id);
//             } else {
//                 requestDeviceReplay(row.device_id, row.generation_id, row.serial_no);
//             }
//         } catch (err) {
//             throw err;
//         }
//     };
// }

function requestDeviceReplay(deviceId, generationId, serialNo) {
    console.log(
        chalk.gray("Requesting replay on %s at %s,%s"),
        devString(deviceId),
        generationId,
        serialNo
    );
    particle.getDevice(deviceId, function (err, device) {
        if (device != null) {
            device.callFunction(
                "replay",
                "" + serialNo + ", " + generationId,
                function (err, data) {
                    // Return codes:
                    //   0  Success
                    //  -1  Failure
                    //  -2  A replay is already in progress
                    // -99  Invalid generation ID
                    if (err) {
                        console.error(
                            chalk.red(
                                "Replay request failed: '%s' on %s at %s,%s with data: %s. EVENTS MAY BE LOST! Ensure the device is online, then restart the collector to request a new replay."
                            ),
                            err,
                            devString(deviceId),
                            generationId,
                            serialNo,
                            data
                        );
                    } else {
                        if (data.return_value == 0) {
                            console.log(
                                chalk.green("Replay request on %s successful."),
                                devString(deviceId)
                            );
                        } else {
                            console.log(
                                chalk.yellow(
                                    "Replay request refused by %s at %s,%s with code %s. EVENTS MAY BE LOST! Waiting for events."
                                ),
                                devString(deviceId),
                                generationId,
                                serialNo,
                                data.return_value
                            );
                        }
                    }
                }
            );
        }
    });
}

function createWebSocketServer(server, eventDB, commandHandler) {
    const wss = new WebSocket.Server({ server: server });
    const connectedClients = [];
    wss.on("connection", function connection(ws, req) {
        connectedClients.push(ws);
        console.log(
            chalk.gray(
                new Date() +
                    " Connection accepted. Connections: " +
                    connectedClients.length
            ),
            req.socket.remoteAddress
        );
        ws.on("message", function incoming(message) {
            const db = new sqlite3(dbFile, { readonly: true });
            try {
                console.log(chalk.gray("Received Message: %s"), message);
                var command = JSON.parse(message);
                const commandHandler = Command.CommandHandler(
                    db,
                    config.blacklist
                );
                commandHandler.onCommand(command, ws);
            } catch (exception) {
                console.error(chalk.red(exception));
                db.close();
            }
        });
        ws.on("close", function (reasonCode, description) {
            connectedClients.splice(connectedClients.indexOf(connection), 1);
            console.log(
                chalk.gray(
                    new Date() +
                        " Peer " +
                        connection.remoteAddress +
                        " disconnected. Connections: " +
                        connectedClients.length
                )
            );
        });
    });

    eventDB.onEvent(function (event) {
        connectedClients.forEach(function (connection) {
            try {
                if (connection.subscribed) {
                    connection.send(JSON.stringify(event));
                }
            } catch (err) {
                console.log(
                    chalk.gray(
                        new Date() +
                            " Peer " +
                            connection.remoteAddress +
                            " disconnected. Connections: " +
                            connectedClients.length
                    )
                );
                connectedClients.splice(
                    connectedClients.indexOf(connection),
                    1
                );
            }
        });
    });
}

ensureDatabase()
    .then(startApp)
    .catch(function (err) {
        console.error(chalk.red(err));
    });
