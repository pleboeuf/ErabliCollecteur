const chalk = require("chalk");

// Endpoint types supported by DatacerFetcher
const ENDPOINT_TYPES = {
    VACUUM: 'vacuum',
    TANK: 'tank',
    WATER: 'water'
};

/**
 * DatacerFetcher - Fetches data from Datacer API and formats it as events
 * Supports vacuum, tank, and water endpoints
 */
class DatacerFetcher {
    constructor(eventDB, datacerEndpoint, db, endpointType = ENDPOINT_TYPES.VACUUM) {
        this.eventDB = eventDB;
        this.datacerEndpoint = datacerEndpoint;
        this.db = db;
        this.endpointType = endpointType;
        this.intervalId = null;
        this.generationId = 0; // Datacer generation counter
        this.serialNo = 0; // Sequential event number
        this.initialized = false;
        this.deviceIdPrefix = this.getDeviceIdPrefix();
    }

    /**
     * Get the device ID prefix based on endpoint type
     */
    getDeviceIdPrefix() {
        switch (this.endpointType) {
            case ENDPOINT_TYPES.TANK:
                return 'DATACER-TANK';
            case ENDPOINT_TYPES.WATER:
                return 'DATACER-WATER';
            default:
                return 'DATACER';
        }
    }

    /**
     * Initialize generation and serial numbers from database
     */
    async initialize() {
        try {
            const sql = `
                SELECT generation_id, serial_no 
                FROM raw_events 
                WHERE device_id LIKE ? 
                ORDER BY generation_id DESC, serial_no DESC 
                LIMIT 1
            `;
            const row = this.db.prepare(sql).get(`${this.deviceIdPrefix}%`);

            if (row) {
                // Check if this is from a previous run (generation ID is a past timestamp)
                const currentTimestamp = Math.floor(Date.now() / 1000);
                const lastGeneration = row.generation_id;

                // If last generation is more than 5 minutes old, start a new generation
                // Otherwise, resume the current generation
                if (currentTimestamp - lastGeneration > 300) {
                    // New generation (new run after significant downtime)
                    this.generationId = currentTimestamp;
                    this.serialNo = 0;
                    console.log(
                        chalk.gray(
                            `Datacer [${this.endpointType}] starting new generation ${this.generationId} (previous: ${lastGeneration})`,
                        ),
                    );
                } else {
                    // Resume current generation (restart within 5 minutes)
                    this.generationId = lastGeneration;
                    this.serialNo = row.serial_no;
                    console.log(
                        chalk.gray(
                            `Datacer [${this.endpointType}] resuming generation ${this.generationId} from serial ${this.serialNo}`,
                        ),
                    );
                }
            } else {
                // First run - use current timestamp as generation ID
                this.generationId = Math.floor(Date.now() / 1000);
                this.serialNo = 0;
                console.log(
                    chalk.gray(
                        `No previous Datacer [${this.endpointType}] events found. Starting generation ${this.generationId}`,
                    ),
                );
            }
            this.initialized = true;
        } catch (error) {
            console.error(
                chalk.red(
                    `Failed to initialize Datacer [${this.endpointType}] state: ${error.message}`,
                ),
            );
            // Fallback to timestamp-based generation
            this.generationId = Math.floor(Date.now() / 1000);
            this.serialNo = 0;
            this.initialized = true;
        }
    }

    /**
     * Start polling Datacer API every minute
     */
    async start() {
        console.log(
            chalk.gray(
                `Starting Datacer [${this.endpointType}] polling from ${this.datacerEndpoint} every 60 seconds`,
            ),
        );

        // Initialize from database first
        await this.initialize();

        // Fetch immediately on start
        this.fetchAndEmit();

        // Then fetch every 1 minute
        this.intervalId = setInterval(() => {
            this.fetchAndEmit();
        }, 60000);
    }

    /**
     * Stop polling
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log(chalk.gray(`Datacer [${this.endpointType}] polling stopped`));
        }
    }

    /**
     * Helper to delay execution
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Fetch data from Datacer API
     */
    async fetchDatacerData() {
        try {
            // Use dynamic import for node-fetch
            const fetch = (await import("node-fetch")).default;

            const response = await fetch(this.datacerEndpoint);
            if (!response.ok) {
                throw new Error(`Response status: ${response.status}`);
            }
            const datacerData = await response.json();
            return datacerData;
        } catch (error) {
            console.warn(
                chalk.yellow(
                    `Failed to fetch Datacer data: ${error.message} (${this.datacerEndpoint})`,
                ),
            );
            return null;
        }
    }

    /**
     * Normalize label (e.g., "EB-V01" -> "EB-V1")
     */
    normalizeLabel(label) {
        return label.replace(/([A-Z])(0+)(\d+)/g, "$1$3");
    }

    /**
     * Normalize device name (temporary fix for non-standard naming)
     * e.g., "H-11-12-13" -> "H11-H12-H13"
     */
    normalizeDeviceName(deviceName) {
        if (deviceName === "H-11-12-13") {
            return "H11-H12-H13";
        }
        return deviceName;
    }

    /**
     * Fetch Datacer data and emit as synthetic events with delays
     */
    async fetchAndEmit() {
        const datacerData = await this.fetchDatacerData();

        if (!datacerData) {
            console.log(
                chalk.yellow(
                    `No Datacer [${this.endpointType}] data received at ${new Date().toLocaleString()}`,
                ),
            );
            return;
        }

        // Get the data array based on endpoint type
        let dataArray;
        let createEventFn;

        switch (this.endpointType) {
            case ENDPOINT_TYPES.TANK:
                dataArray = datacerData.tank;
                createEventFn = this.createSyntheticTankEvent.bind(this);
                break;
            case ENDPOINT_TYPES.WATER:
                dataArray = datacerData.water;
                createEventFn = this.createSyntheticWaterEvent.bind(this);
                break;
            default: // VACUUM
                dataArray = datacerData.vacuum;
                createEventFn = this.createSyntheticVacuumEvent.bind(this);
                break;
        }

        if (!dataArray || dataArray.length === 0) {
            console.log(
                chalk.yellow(
                    `No Datacer [${this.endpointType}] data in response at ${new Date().toLocaleString()}`,
                ),
            );
            return;
        }

        console.log(
            chalk.gray(
                `Received ${dataArray.length} Datacer [${this.endpointType}] readings at ${new Date().toLocaleString()}`,
            ),
        );

        // Process each item with delay between events
        for (let i = 0; i < dataArray.length; i++) {
            const item = dataArray[i];

            // Create synthetic event in Particle event format
            const syntheticEvent = createEventFn(item);

            // Emit the event through EventDatabase
            this.eventDB.handleEvent(syntheticEvent);

            // Add 200ms delay between events to avoid saturating downstream modules
            if (i < dataArray.length - 1) {
                await this.delay(200);
            }
        }
    }

    /**
     * Create a synthetic Particle-like event from Datacer vacuum data
     */
    createSyntheticVacuumEvent(vacuumItem) {
        this.serialNo++;

        // Use the device name from Datacer as the device ID for better logging
        // This will show as "A1 (A1-A2)" in logs where A1 is the label and A1-A2 is the device
        const deviceId = this.normalizeDeviceName(vacuumItem.device);
        const deviceName = this.normalizeLabel(vacuumItem.label); // Use label instead of device name

        // Update device attributes with label as the display name
        // This makes the logs show "label (device)" format, e.g., "A1 (A1-A2)"
        this.eventDB.setAttributes(deviceId, {
            id: deviceId,
            name: deviceName,
        });

        // Determine event name based on device name
        // Use "sensor/vacuum" for pumps (POMPE devices), "Vacuum/Lignes" for vacuum lines
        const eventName = this.normalizeDeviceName(vacuumItem.device).includes(
            "POMPE",
        )
            ? "sensor/vacuum"
            : "Vacuum/Lignes";

        // Format event data in the same structure as Particle events
        const eventData = {
            noSerie: this.serialNo,
            generation: this.generationId,
            eData: parseFloat(vacuumItem.rawValue) || 0,
            temp: parseFloat(vacuumItem.temp) || 0,
            ref: parseFloat(vacuumItem.referencialValue) || 0,
            percentCharge: parseFloat(vacuumItem.percentCharge) || 0,
            offset: vacuumItem.offset || 0,
            device: this.normalizeDeviceName(vacuumItem.device),
            label: this.normalizeLabel(vacuumItem.label),
            lastUpdatedAt: vacuumItem.lastUpdatedAt,
            eName: eventName, // Event name to identify Datacer events
        };

        // Create Particle-like event structure
        return {
            coreid: deviceId,
            published_at: eventData.lastUpdatedAt,
            name: this.normalizeLabel(vacuumItem.label), // Use sensor label (e.g., "EB-V1") instead of device ID
            data: JSON.stringify(eventData),
            upstream: false, // Mark as local/synthetic event
        };
    }

    /**
     * Create a synthetic Particle-like event from Datacer tank data
     */
    createSyntheticTankEvent(tankItem) {
        this.serialNo++;

        // Use device name from Datacer as the device ID
        const deviceId = tankItem.device || `${this.deviceIdPrefix}-${tankItem.code}`;
        const tankName = tankItem.name; // Tank name (e.g., "RC1", "RF1")

        // Update device attributes
        this.eventDB.setAttributes(deviceId, {
            id: deviceId,
            name: tankName,
        });

        // Format event data
        const eventData = {
            noSerie: this.serialNo,
            generation: this.generationId,
            code: tankItem.code,
            name: tankName,
            device: deviceId,
            rawValue: parseFloat(tankItem.rawValue) || 0,
            depth: parseFloat(tankItem.Depth) || 0,
            capacity: parseFloat(tankItem.Capacity) || 0,
            fill: parseFloat(tankItem.fill) || 0,
            lastUpdatedAt: tankItem.lastUpdatedAt,
            eName: "Tank/Level",
        };

        // Create Particle-like event structure
        return {
            coreid: deviceId,
            published_at: tankItem.lastUpdatedAt,
            name: tankName, // Use tank name as event name
            data: JSON.stringify(eventData),
            upstream: false,
        };
    }

    /**
     * Create a synthetic Particle-like event from Datacer water data
     */
    createSyntheticWaterEvent(waterItem) {
        this.serialNo++;

        // Use device name or ID from Datacer
        const deviceId = `${this.deviceIdPrefix}-${waterItem.id}`;
        const meterName = waterItem.Name; // Water meter name (e.g., "COMPTEUR-EAU")

        // Update device attributes
        this.eventDB.setAttributes(deviceId, {
            id: deviceId,
            name: meterName,
        });

        // Format event data
        const eventData = {
            noSerie: this.serialNo,
            generation: this.generationId,
            id: waterItem.id,
            name: meterName,
            device: deviceId,
            volume_total: parseFloat(waterItem.volume_total) || 0,
            volume_heure: parseFloat(waterItem.volume_heure) || 0,
            volume_entaille: parseFloat(waterItem.volume_entaille) || 0,
            volume_since_reset: parseFloat(waterItem.volume_since_reset) || 0,
            lastUpdatedAt: waterItem.timestamp,
            eName: "Water/Volume",
        };

        // Create Particle-like event structure
        return {
            coreid: deviceId,
            published_at: waterItem.timestamp,
            name: meterName, // Use meter name as event name
            data: JSON.stringify(eventData),
            upstream: false,
        };
    }
}

module.exports = { DatacerFetcher, ENDPOINT_TYPES };
