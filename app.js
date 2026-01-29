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
const { DatacerFetcher } = require("./datacer.js");
const config = require("./config.json");
const dbFile = config.database || "raw_events.sqlite3";
const particle = new Particle();
const password = process.env.PARTICLE_TOKEN;
const username = process.env.PARTICLE_USER;
var accessToken;
var eventDB;
const nodeArg = process.argv;

// --- Added ---
let inactivityTimer = null;
const INACTIVITY_TIMEOUT_MS = 150 * 1000; // 150 seconds
let mainDbConnection = null; // Keep a reference to the main DB connection
let webSocketServer = null; // Keep a reference to the WebSocket server
let particleStream = null; // Keep a reference to the Particle stream
let datacerFetcher = null; // Keep a reference to the Datacer fetcher
// --- End Added ---

function devString(deviceId) {
    // Ensure eventDB is initialized before using devString
    return eventDB ? eventDB.devString(deviceId) : `? (${deviceId})`;
}

// --- Added Graceful Shutdown Function ---
function shutdown(reason) {
    console.log(chalk.yellow(`\nShutting down gracefully: ${reason}`));

    // Clear the inactivity timer if it's running
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }

    // Stop Datacer Fetcher if it exists
    if (datacerFetcher) {
        console.log(chalk.gray("Stopping Datacer fetcher..."));
        datacerFetcher.stop();
        datacerFetcher = null;
    }

    // Close Particle Stream if it exists
    if (particleStream) {
        console.log(chalk.gray("Closing Particle event stream..."));
        // particle-api-js stream doesn't have a standard close/abort in older versions documented easily.
        // Often, just letting the process exit handles cleanup, but we can try aborting.
        try {
            if (typeof particleStream.abort === "function") {
                particleStream.abort();
            }
        } catch (err) {
            console.error(
                chalk.red("Error trying to abort particle stream:"),
                err
            );
        }
        particleStream = null;
    }

    // Close WebSocket Server if it exists
    if (webSocketServer) {
        console.log(chalk.gray("Closing WebSocket server..."));
        webSocketServer.close((err) => {
            if (err) {
                console.error(
                    chalk.red("Error closing WebSocket server:"),
                    err
                );
            } else {
                console.log(chalk.gray("WebSocket server closed."));
            }
            webSocketServer = null; // Ensure it's marked as closed
            // Continue shutdown after WSS is closed
            closeDatabaseAndExit();
        });
    } else {
        // If WSS wasn't running or already closed, proceed
        closeDatabaseAndExit();
    }
}

function closeDatabaseAndExit() {
    // Close Database Connection if it exists
    if (mainDbConnection) {
        console.log(chalk.gray("Closing database connection..."));
        try {
            mainDbConnection.close();
            console.log(chalk.gray("Database connection closed."));
        } catch (dbErr) {
            console.error(chalk.red("Error closing database:"), dbErr);
        }
        mainDbConnection = null; // Ensure it's marked as closed
    }

    console.log(chalk.green("Shutdown complete. Exiting."));
    process.exit(0);
}
// --- End Added Graceful Shutdown Function ---

function startApp(db) {
    console.log(chalk.gray("Starting application..."));
    mainDbConnection = db; // Store the main DB connection
    eventDB = new eventmodule.EventDatabase(db);
    const app = createExpressApp(db); // Pass db here if needed, though the route handler reopens it

    // Start Datacer fetcher if endpoint is configured
    if (process.env.ENDPOINT_VAC) {
        datacerFetcher = new DatacerFetcher(eventDB, process.env.ENDPOINT_VAC, db);
        datacerFetcher.start();
    } else {
        console.log(
            chalk.yellow(
                "ENDPOINT_VAC not configured. Datacer polling disabled."
            )
        );
    }

    // Do not connect to Particle cloud for playbackOnly
    // Pass the shutdown function down
    connectToParticleCloud(db, eventDB, nodeArg[2], nodeArg[3], shutdown);

    try {
        const port = config.port || "3000";
        app.set("port", port);
        const server = http.createServer(app);
        // Store the WebSocket server reference and pass db/shutdown
        webSocketServer = createWebSocketServer(server, eventDB, shutdown);
        server.listen(port);
        console.log(chalk.green("Server started: http://localhost:%s"), port);

        // --- Added Signal Handlers for graceful shutdown ---
        process.on("SIGTERM", () => shutdown("SIGTERM received"));
        process.on("SIGINT", () => shutdown("SIGINT received (Ctrl+C)"));
        // --- End Added Signal Handlers ---
    } catch (err) {
        console.error(err);
        // Ensure DB is closed on startup error too
        if (mainDbConnection) {
            mainDbConnection.close();
        }
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
                // Close the file descriptor if the file exists
                fs.close(fd, (closeErr) => {
                    if (closeErr) {
                        console.error(
                            chalk.yellow(
                                "Warning: Could not close file descriptor for existing DB"
                            ),
                            closeErr
                        );
                    }
                });
                console.log(chalk.gray("Using existing database: %s"), dbFile);
                try {
                    // Ensure the connection is properly opened
                    const db = new sqlite3(dbFile);
                    resolve(db);
                } catch (dbErr) {
                    reject(dbErr);
                }
            }
        });
    });
}

function createDatabase(schema) {
    return new Promise(function (resolve, reject) {
        let db; // Define db outside try block
        try {
            db = new sqlite3(dbFile);
            db.exec(schema); // Use exec for multi-statement schemas potentially
            resolve(db);
        } catch (err) {
            // Attempt to close DB if creation failed partially
            if (db) {
                try {
                    db.close();
                } catch (closeErr) {
                    /* Ignore close error */
                }
            }
            reject(err);
        }
    });
}

function createExpressApp(db) {
    // Accept db, though the handler re-opens it currently
    var app = express();
    app.use(express.static(path.join(__dirname, "public")));
    // Serve index.html for the root path specifically
    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, "index.html"));
    });
    app.get("/device/:id", function (req, res) {
        var generationId = req.query.generation;
        var serialNo = req.query.since;
        // It's generally better practice to open/close connections per request for web servers
        // unless using a connection pool. Re-opening here is okay for sqlite.
        let reqDb = null;
        try {
            reqDb = new sqlite3(dbFile, { readonly: true }); // Open read-only
            var sql =
                "select * from raw_events where device_id = ? and generation_id = ? and serial_no > ? order by serial_no"; // Added order by
            var params = [req.params.id, generationId, serialNo];

            const rows = reqDb.prepare(sql).all(params);
            var events = rows
                .map(function (row) {
                    // Basic validation before parsing
                    let data = {};
                    try {
                        if (row.raw_data) {
                            data = JSON.parse(row.raw_data);
                        }
                    } catch (parseError) {
                        console.warn(
                            chalk.yellow(
                                `Skipping row due to JSON parse error: device=${row.device_id}, gen=${row.generation_id}, sn=${row.serial_no}`
                            )
                        );
                        return null; // Skip this row
                    }
                    return {
                        coreid: row.device_id,
                        published_at: row.published_at, // Keep original format
                        name: data.eName || "collector/replay", // Use eName if available
                        data: row.raw_data,
                    };
                })
                .filter((event) => event !== null); // Filter out skipped rows

            res.setHeader("Content-Type", "application/json"); // Use correct content type
            res.send(JSON.stringify(events));
        } catch (err) {
            console.error(
                chalk.red("Error handling /device/:id request:"),
                err
            );
            // Avoid sending detailed error messages to the client in production
            res.status(500).send(
                JSON.stringify({ error: "Internal Server Error" })
            );
        } finally {
            // Ensure the request-specific DB connection is closed
            if (reqDb) {
                reqDb.close();
            }
        }
    });
    return app;
}

// Accept shutdown function as an argument
function connectToParticleCloud(
    db,
    eventDB,
    streamOption,
    replayOption,
    shutdownCallback
) {
    particle
        .login({
            username,
            password,
        })
        .then(function (data) {
            accessToken = data.body.access_token;
            console.log(
                chalk.gray("Login to cloud completed. Listing devices...")
            );
            return particle.listDevices({ auth: accessToken }); // Return promise for chaining
        })
        .then(function (Devices) {
            const myDevices = Devices.body;
            console.log(
                chalk.gray("Got %s devices from cloud."),
                myDevices.length
            );
            myDevices.forEach(function (dev) {
                eventDB.setAttributes(dev.id, dev);
            });
            if (replayOption === "allDeviceReplay") {
                requestAllDeviceReplay(db); // Pass db here
            }
            if (streamOption !== "noStream") {
                // Pass shutdown callback to openStream
                openStream(eventDB, shutdownCallback);
            } else {
                console.log(
                    chalk.yellow(
                        "Stream option set to 'noStream'. Not connecting to Particle event stream."
                    )
                );
                // If not streaming, maybe shutdown immediately or based on other conditions?
                // For now, it just won't connect to the stream.
                // If you want it to exit if *only* 'noStream' is active, add logic here.
            }
        })
        .catch(function (err) {
            // Consolidated catch block
            console.error(
                chalk.red("Failed during Particle connection/setup:"),
                err
            );
            // Decide if we should retry or shutdown
            if (shutdownCallback) {
                shutdownCallback(
                    `Particle connection failed: ${err.message || err}`
                );
            } else {
                // Fallback if shutdown wasn't passed (shouldn't happen with current flow)
                console.error(
                    chalk.red(
                        "No shutdown callback available. Exiting forcefully."
                    )
                );
                process.exit(1);
            }
        });
}

// Accept shutdown function as an argument
function openStream(eventDB, shutdownCallback) {
    console.log(chalk.gray("Connecting to event stream..."));

    // --- Function to reset the inactivity timer ---
    const resetTimer = () => {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
        }
        console.log(
            chalk.grey(
                `Resetting inactivity timer (${INACTIVITY_TIMEOUT_MS / 1000}s)`
            )
        );
        inactivityTimer = setTimeout(() => {
            shutdownCallback("Inactivity timeout reached. No events received.");
        }, INACTIVITY_TIMEOUT_MS);
    };
    // --- End Function ---

    function connect() {
        particle
            .getEventStream({ deviceId: "mine", auth: accessToken })
            .then(function (newStream) {
                particleStream = newStream; // Store stream reference
                console.log(chalk.green("Event stream connected."));
                resetTimer(); // Start the timer once connected

                particleStream.on("event", function (event) {
                    console.log("Event: ", JSON.stringify(event)); // Log the raw event
                    resetTimer(); // Reset timer on every event
                    if (event.code == "ETIMEDOUT") {
                        console.error(
                            chalk.red(new Date() + " Timeout error on stream")
                        );
                        // ETIMEDOUT might mean the connection needs resetting, but Particle SDK might handle this.
                        // If persistent, might need explicit reconnect logic.
                    } else {
                        // Make sure eventDB is initialized
                        if (eventDB) {
                            eventDB.handleEvent(event);
                        } else {
                            console.error(
                                chalk.red(
                                    "eventDB not initialized when handling event!"
                                )
                            );
                        }
                    }
                });

                particleStream.on("close", () => {
                    console.warn(
                        chalk.yellow("Event stream closed unexpectedly.")
                    );
                    particleStream = null; // Clear reference
                    if (inactivityTimer) clearTimeout(inactivityTimer); // Stop timer
                    // Optional: Implement retry logic here if desired
                    // For now, we rely on the inactivity timer of the *application*
                    // If the stream closes, and no new one opens, the app timer will eventually fire.
                    // Alternatively, trigger shutdown immediately:
                    // shutdownCallback("Particle stream closed unexpectedly.");
                });

                particleStream.on("error", (err) => {
                    console.error(chalk.red("Event stream error:"), err);
                    particleStream = null; // Clear reference
                    if (inactivityTimer) clearTimeout(inactivityTimer); // Stop timer
                    // Optional: Implement retry logic or shutdown
                    // shutdownCallback(`Particle stream error: ${err.message}`);
                });
            })
            .catch(function (err) {
                console.error(chalk.red("Stream connection failed: %s"), err);
                particleStream = null; // Clear reference
                if (inactivityTimer) clearTimeout(inactivityTimer); // Stop timer
                // Optional: Implement retry logic or shutdown
                shutdownCallback(`Stream connection failed: ${err.message}`);
            });
    }

    connect(); // Initial connection attempt
}

function requestAllDeviceReplay(db) {
    // Accept db as argument
    // Ensure db is valid before proceeding
    if (!db) {
        console.error(
            chalk.red(
                "Database connection not available for requestAllDeviceReplay."
            )
        );
        return;
    }
    var sql =
        "SELECT raw_events.device_id AS device_id, raw_events.generation_id AS generation_id, MAX(raw_events.serial_no) AS serial_no " +
        "FROM raw_events " +
        "JOIN (SELECT device_id, MAX(generation_id) AS max_generation_id FROM raw_events GROUP BY device_id) AS gens " +
        "ON raw_events.device_id = gens.device_id AND raw_events.generation_id = gens.max_generation_id " +
        "GROUP BY raw_events.device_id, raw_events.generation_id"; // Group by gen_id too for clarity
    console.log(chalk.blue("Requesting latest replay for all devices..."));
    try {
        const rows = db.prepare(sql).all(); // Use all() for simplicity if result set is small
        if (
            !rows ||
            rows.length === 0 ||
            (rows.length === 1 && rows[0].device_id === null)
        ) {
            console.log(
                chalk.gray(
                    "No existing device data found to request replay from."
                )
            );
            return;
        }

        rows.forEach((row) => {
            if (row.device_id == null) {
                // This case should be less likely with the improved query/check above
                console.log(
                    chalk.gray(
                        "Skipping row with null device_id during replay request."
                    )
                );
            } else if (
                typeof row.generation_id === "undefined" ||
                row.generation_id === null
            ) {
                console.error(
                    chalk.red(
                        "Got undefined/null generation for device %s. Cannot request replay. Waiting for new events. POSSIBLE DATA LOSS!"
                    ),
                    devString(row.device_id) // Use devString here
                );
            } else {
                requestDeviceReplay(
                    row.device_id,
                    row.generation_id,
                    row.serial_no // serial_no can be null if no events for max generation yet, handle in requestDeviceReplay if needed
                );
            }
        });
    } catch (err) {
        throw err;
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
    // Handle potential null serialNo (e.g., new generation with no events yet)
    const replaySerialNo = serialNo === null ? -1 : serialNo; // Particle might expect -1 or 0 to start from beginning

    console.log(
        chalk.gray("Requesting replay on %s starting after %s,%s"),
        devString(deviceId),
        generationId,
        replaySerialNo
    );

    // particle.getDevice is deprecated, use particle.getDeviceInfo
    particle.getDeviceInfo({ deviceId: deviceId, auth: accessToken }).then(
        (deviceInfo) => {
            if (!deviceInfo || !deviceInfo.body || !deviceInfo.body.connected) {
                console.warn(
                    chalk.yellow(
                        `Device ${devString(
                            deviceId
                        )} is not connected. Cannot request replay.`
                    )
                );
                return;
            }

            // Use particle.callFunction directly
            particle
                .callFunction({
                    deviceId: deviceId,
                    name: "replay", // Function name on the Particle device
                    argument: `${replaySerialNo},${generationId}`,
                    auth: accessToken,
                })
                .then(
                    (data) => {
                        // Return codes:
                        //   0  Success (or accepted)
                        //  -1  Failure (generic)
                        //  -2  A replay is already in progress
                        // -99  Invalid generation ID or other argument error
                        if (
                            data &&
                            data.body &&
                            typeof data.body.return_value !== "undefined"
                        ) {
                            const returnValue = data.body.return_value;
                            if (returnValue === 0) {
                                console.log(
                                    chalk.green(
                                        "Replay request on %s successfully acknowledged."
                                    ),
                                    devString(deviceId)
                                );
                            } else {
                                console.warn(
                                    // Use warn instead of log for non-zero returns
                                    chalk.yellow(
                                        "Replay request refused by %s for %s,%s with code %s. Waiting for events."
                                    ),
                                    devString(deviceId),
                                    generationId,
                                    replaySerialNo,
                                    returnValue
                                );
                            }
                        } else {
                            console.error(
                                chalk.red(
                                    "Replay request response from %s was malformed or missing return_value. Data: %s"
                                ),
                                devString(deviceId),
                                JSON.stringify(data)
                            );
                        }
                    },
                    (err) => {
                        // Error handler for callFunction
                        console.error(
                            chalk.red(
                                "Replay request failed for %s at %s,%s: %s. EVENTS MAY BE LOST! Ensure the device is online and firmware function exists, then potentially restart collector."
                            ),
                            devString(deviceId),
                            generationId,
                            replaySerialNo,
                            err.body
                                ? err.body.error ||
                                      err.body.message ||
                                      JSON.stringify(err.body)
                                : err.message || err
                        );
                        // Consider if shutdown is needed on critical failure
                    }
                );
        },
        (err) => {
            // Error handler for getDeviceInfo
            console.error(
                chalk.red(
                    `Failed to get device info for ${devString(
                        deviceId
                    )} before replay request: ${
                        err.body?.error || err.message || err
                    }. Cannot request replay.`
                )
            );
        }
    );
}

// Accept shutdown function as an argument
function createWebSocketServer(server, eventDB, shutdownCallback) {
    const wss = new WebSocket.Server({ server: server });
    const connectedClients = new Set(); // Use a Set for easier add/delete

    wss.on("connection", function connection(ws, req) {
        const remoteAddress = req.socket.remoteAddress; // Get address once
        connectedClients.add(ws);
        console.log(
            chalk.gray(
                `${new Date().toISOString()} Connection accepted from ${remoteAddress}. Connections: ${
                    connectedClients.size
                }`
            )
        );

        // Add error handling for individual sockets
        ws.on("error", (error) => {
            console.error(
                chalk.red(`WebSocket error from ${remoteAddress}:`),
                error
            );
            // Connection might close automatically after error, but ensure cleanup
            connectedClients.delete(ws);
            console.log(
                chalk.gray(
                    `Client removed due to error. Connections: ${connectedClients.size}`
                )
            );
            try {
                ws.close();
            } catch (e) {
                /* Ignore closing error if already closed */
            }
        });

        ws.on("message", function incoming(message) {
            // Use a try-catch block (finally is no longer needed for cmdDb closing here)
            let cmdDb = null; // Keep track if we opened it
            try {
                // Convert buffer to string if necessary
                const messageString = message.toString();
                console.log(
                    chalk.gray(`Received Message from ${remoteAddress}: %s`),
                    messageString
                );
                var command = JSON.parse(messageString);

                // Open a read-only connection for this command handler
                // This connection will be passed to command.js, which is responsible for closing it.
                cmdDb = new sqlite3(dbFile, { readonly: true });
                const commandHandler = Command.CommandHandler(
                    cmdDb,
                    config.blacklist || [] // Ensure blacklist is an array
                );
                commandHandler.onCommand(command, ws);
                // *** cmdDb is intentionally NOT closed here. command.js will close it. ***
                cmdDb = null; // Set to null so the catch block doesn't try to close it if commandHandler throws immediately
            } catch (exception) {
                console.error(
                    chalk.red(
                        `Error processing message from ${remoteAddress}:`
                    ),
                    exception
                );
                // Send error back to client if possible
                try {
                    ws.send(
                        JSON.stringify({
                            name: "collector/error",
                            data: {
                                message: "Failed to process command",
                                error: exception.message,
                            },
                        })
                    );
                } catch (sendError) {
                    console.error(
                        chalk.yellow(
                            `Failed to send error message back to ${remoteAddress}:`
                        ),
                        sendError
                    );
                }

                // If an error occurred *before* or *during* commandHandler.onCommand setup,
                // and cmdDb was opened, we should close it here.
                if (cmdDb) {
                    try {
                        console.warn(
                            chalk.yellow(
                                "Closing command DB connection due to error during message processing."
                            )
                        );
                        cmdDb.close();
                    } catch (closeErr) {
                        console.error(
                            chalk.red(
                                "Error closing command DB connection after an error:"
                            ),
                            closeErr
                        );
                    }
                }
            }
        });

        ws.on("close", function (reasonCode, description) {
            connectedClients.delete(ws);
            console.log(
                chalk.gray(
                    `${new Date().toISOString()} Peer ${remoteAddress} disconnected (Code: ${reasonCode}). Connections: ${
                        connectedClients.size
                    }`
                )
            );
        });
    });

    // Handle errors on the server itself
    wss.on("error", (error) => {
        console.error(chalk.red("WebSocket Server Error:"), error);
        // This might be a fatal error (e.g., port conflict)
        shutdownCallback(`WebSocket server error: ${error.message}`);
    });

    eventDB.onEvent(function (event) {
        // Create the message once
        const eventString = JSON.stringify(event);
        // Iterate safely over clients
        connectedClients.forEach(function (client) {
            // Check if client is still open and subscribed
            if (client.readyState === WebSocket.OPEN && client.subscribed) {
                client.send(eventString, (err) => {
                    if (err) {
                        console.error(
                            chalk.red(
                                `Failed to send event to client ${client._socket?.remoteAddress}:`
                            ),
                            err
                        );
                        // Assume client is disconnected, remove it
                        connectedClients.delete(client);
                        console.log(
                            chalk.gray(
                                `Client removed due to send error. Connections: ${connectedClients.size}`
                            )
                        );
                        try {
                            client.close();
                        } catch (e) {
                            /* Ignore closing error */
                        }
                    }
                });
            } else if (client.readyState !== WebSocket.OPEN) {
                // Clean up clients that are no longer open if missed by 'close' event
                console.log(
                    chalk.gray(
                        `Removing non-open client ${client._socket?.remoteAddress}. Connections: ${connectedClients.size}`
                    )
                );
                connectedClients.delete(client);
            }
        });
    });

    return wss; // Return the server instance
}

// --- Main Execution ---
ensureDatabase()
    .then(startApp)
    .catch(function (err) {
        console.error(chalk.red("Fatal error during startup:"), err);
        // Ensure DB is closed if startup fails after opening it
        if (mainDbConnection) {
            try {
                mainDbConnection.close();
            } catch (e) {
                /* ignore */
            }
        }
        process.exit(1); // Exit with error code
    });
