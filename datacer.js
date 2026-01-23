const chalk = require("chalk");

/**
 * DatacerFetcher - Fetches vacuum data from Datacer API and formats it as events
 */
class DatacerFetcher {
    constructor(eventDB, datacerEndpoint) {
        this.eventDB = eventDB;
        this.datacerEndpoint = datacerEndpoint;
        this.intervalId = null;
        this.generationId = 0; // Datacer generation counter
        this.serialNo = 0; // Sequential event number
    }

    /**
     * Start polling Datacer API every minute
     */
    start() {
        console.log(
            chalk.gray(
                `Starting Datacer polling from ${this.datacerEndpoint} every 60 seconds`
            )
        );

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
            console.log(chalk.gray("Datacer polling stopped"));
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
            const fetch = (
                await import("node-fetch")
            ).default;
            
            const response = await fetch(this.datacerEndpoint);
            if (!response.ok) {
                throw new Error(`Response status: ${response.status}`);
            }
            const datacerData = await response.json();
            return datacerData;
        } catch (error) {
            console.warn(
                chalk.yellow(
                    `Failed to fetch Datacer data: ${error.message} (${this.datacerEndpoint})`
                )
            );
            return null;
        }
    }

    /**
     * Normalize label (e.g., "EB-V01" -> "EB-V1")
     */
    normalizeLabel(label) {
        return label.replace(/([A-Z])0*/, "$1");
    }

    /**
     * Fetch Datacer data and emit as synthetic events with delays
     */
    async fetchAndEmit() {
        const datacerData = await this.fetchDatacerData();

        if (!datacerData || !datacerData.vacuum) {
            console.log(
                chalk.yellow(
                    `No Datacer vacuum data received at ${new Date().toLocaleString()}`
                )
            );
            return;
        }

        console.log(
            chalk.gray(
                `Received ${datacerData.vacuum.length} Datacer vacuum readings at ${new Date().toLocaleString()}`
            )
        );

        // Process each vacuum sensor with 100ms delay between events
        for (let i = 0; i < datacerData.vacuum.length; i++) {
            const item = datacerData.vacuum[i];

            // Create synthetic event in Particle event format
            const syntheticEvent = this.createSyntheticEvent(item);

            // Emit the event through EventDatabase
            this.eventDB.handleEvent(syntheticEvent);

            // Add 100ms delay between events to avoid saturating downstream modules
            if (i < datacerData.vacuum.length - 1) {
                await this.delay(100);
            }
        }
    }

    /**
     * Create a synthetic Particle-like event from Datacer vacuum data
     */
    createSyntheticEvent(vacuumItem) {
        this.serialNo++;

        // Normalize the label (remove leading zeros)
        const normalizedLabel = this.normalizeLabel(vacuumItem.label);

        // Use the device name from Datacer as the device ID for better logging
        // This will show as "G9-G10 (DATACER)" in logs instead of "? (DATACER-VACUUM-001)"
        const deviceId = "DATACER";
        const deviceName = vacuumItem.device;

        // Update device attributes with current device name
        // Since all Datacer events share the same ID, the name will reflect the last processed device
        // But each event will show the correct device name when logged
        this.eventDB.setAttributes(deviceId, {
            id: deviceId,
            name: deviceName,
        });

        // Format event data in the same structure as Particle events
        const eventData = {
            noSerie: this.serialNo,
            generation: this.generationId,
            eData: parseFloat(vacuumItem.rawValue) || 0,
            temp: parseFloat(vacuumItem.temp) || 0,
            ref: parseFloat(vacuumItem.referencialValue) || 0,
            percentCharge: parseFloat(vacuumItem.percentCharge) || 0,
            offset: vacuumItem.offset || 0,
            device: vacuumItem.device,
            label: vacuumItem.label,
            normalizedLabel: normalizedLabel,
            lastUpdatedAt: vacuumItem.lastUpdatedAt,
            eName: "Vacuum/Datacer", // Event name to identify Datacer events
        };

        // Add runtime info for specific devices
        if (["EB-V1", "EB-V2", "EB-V3"].includes(vacuumItem.device)) {
            eventData.RunTimeSinceMaint = vacuumItem.RunTimeSinceMaint;
            eventData.NeedMaintenance = vacuumItem.NeedMaintenance;
        }

        // Create Particle-like event structure
        return {
            coreid: deviceId, // Use "DATACER" as device ID
            published_at: new Date().toISOString(),
            name: "Vacuum/Datacer",
            data: JSON.stringify(eventData),
            upstream: false, // Mark as local/synthetic event
        };
    }
}

module.exports = { DatacerFetcher };
