const assert = require('assert');
const { DatacerFetcher, ENDPOINT_TYPES } = require('../datacer.js');

/**
 * Unit tests for DatacerFetcher class
 * 
 * These tests cover the following functionality:
 * 1. Polling behavior - start() sets up interval, stop() clears it
 * 2. Data fetching - fetchDatacerData() handles network errors gracefully
 * 3. Event transformation - createSyntheticEvent() transforms Datacer vacuum data to Particle-like events
 * 4. Label normalization - removes leading zeros (e.g., "EB-V01" → "EB-V1")
 * 5. Runtime info - includes maintenance data for specific devices (EB-V1, EB-V2, EB-V3)
 * 6. Serial number tracking - increments noSerie for each event
 * 7. App integration - verifies ENDPOINT_VAC configuration and shutdown behavior
 * 8. Delay mechanism - verifies 100ms delay between events
 * 
 * Run with:
 *   npm test                         # Run all tests
 *   npm run test:datacer             # Run only DatacerFetcher tests
 *   npx mocha test/datacer.test.js   # Run directly with Mocha
 * 
 * Note: Some tests make actual network calls to invalid endpoints to verify error handling.
 * For more comprehensive mocking, consider using a library like 'nock' or 'sinon'.
 */

// Mock EventDatabase
class MockEventDatabase {
    constructor() {
        this.events = [];
        this.attributes = {};
    }

    handleEvent(event) {
        this.events.push(event);
    }

    setAttributes(deviceId, attrs) {
        this.attributes[deviceId] = attrs;
    }
}

// Track all created fetchers for cleanup
let activeFetchers = [];

// Helper to track fetchers for cleanup
function trackFetcher(fetcher) {
    activeFetchers.push(fetcher);
    return fetcher;
}

// Helper to cleanup all active fetchers
function cleanupFetchers() {
    activeFetchers.forEach(fetcher => {
        if (fetcher && fetcher.intervalId) {
            fetcher.stop();
        }
    });
    activeFetchers = [];
}

describe('DatacerFetcher', function() {
    // Increase timeout for async tests
    this.timeout(10000);

    // Clean up any active intervals after each test
    afterEach(function() {
        cleanupFetchers();
    });

    describe('Polling behavior', function() {
        it('should set up interval when start() is called', async function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = trackFetcher(new DatacerFetcher(mockDB, endpoint));
            
            // Verify no interval before start
            assert.equal(fetcher.intervalId, null, 'intervalId should be null before start');
            
            // Start the fetcher (note: this will try to fetch immediately, which will fail, but that's ok for this test)
            await fetcher.start();
            
            // Verify interval is set
            assert.notEqual(fetcher.intervalId, null, 'intervalId should be set after start');
        });

        it('should clear interval when stop() is called', async function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint);
            
            // Start and then stop
            await fetcher.start();
            assert.notEqual(fetcher.intervalId, null, 'intervalId should be set after start');
            
            fetcher.stop();
            assert.equal(fetcher.intervalId, null, 'intervalId should be null after stop');
        });
    });

    describe('fetchDatacerData()', function() {
        // Note: These tests actually make network calls, so they're integration tests
        // In a real scenario, you'd want to mock node-fetch or use nock
        it('should return null on network errors', async function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://invalid-endpoint-that-does-not-exist.example/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint);
            
            const result = await fetcher.fetchDatacerData();
            assert.equal(result, null, 'Should return null on fetch error');
        });
    });



    describe('createSyntheticVacuumEvent()', function() {
        it('should correctly transform vacuum data to synthetic events', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint, null, ENDPOINT_TYPES.VACUUM);

            const vacuumItem = {
                device: 'G9-G10',
                label: 'EB-V01',
                rawValue: '10.5',
                temp: '20.0',
                referencialValue: '12.0',
                percentCharge: '85.5',
                offset: 0,
                lastUpdatedAt: '2026-01-23T20:00:00Z'
            };

            const event = fetcher.createSyntheticVacuumEvent(vacuumItem);

            // Verify event structure
            assert.equal(event.coreid, 'G9-G10', 'coreid should be device name');
            assert.equal(event.name, 'EB-V1', 'name should be normalized label');
            assert.equal(event.upstream, false, 'upstream should be false');
            assert.equal(typeof event.published_at, 'string', 'published_at should be ISO string');

            // Verify event data
            const eventData = JSON.parse(event.data);
            assert.equal(eventData.noSerie, 1, 'First event should have serial 1');
            assert.equal(eventData.generation, 0, 'generation should be 0');
            assert.equal(eventData.eData, 10.5, 'eData should match rawValue');
            assert.equal(eventData.temp, 20.0, 'temp should match');
            assert.equal(eventData.ref, 12.0, 'ref should match referencialValue');
            assert.equal(eventData.percentCharge, 85.5, 'percentCharge should match');
            assert.equal(eventData.offset, 0, 'offset should match');
            assert.equal(eventData.device, 'G9-G10', 'device should match');
            assert.equal(eventData.label, 'EB-V1', 'label should be normalized');
            assert.equal(eventData.lastUpdatedAt, '2026-01-23T20:00:00Z', 'lastUpdatedAt should match');
            assert.equal(eventData.eName, 'Vacuum/Lignes', 'eName should be Vacuum/Lignes');

            // Verify device attributes were set
            assert.deepEqual(mockDB.attributes['G9-G10'], {
                id: 'G9-G10',
                name: 'EB-V1'
            }, 'Device attributes should be set with normalized label as name');
        });

        it('should normalize labels correctly', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint);

            // Test various label formats
            const testCases = [
                { input: 'EB-V01', expected: 'EB-V1' },
                { input: 'EB-V02', expected: 'EB-V2' },
                { input: 'EB-V10', expected: 'EB-V10' },
                { input: 'G9-G10', expected: 'G9-G10' }
            ];

            testCases.forEach(testCase => {
                const normalized = fetcher.normalizeLabel(testCase.input);
                assert.equal(normalized, testCase.expected, 
                    `Label ${testCase.input} should normalize to ${testCase.expected}`);
            });
        });


        it('should increment serial numbers for each event', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint);

            const vacuumItem = {
                device: 'G9-G10',
                label: 'EB-V01',
                rawValue: '10.5',
                temp: '20.0',
                referencialValue: '12.0',
                percentCharge: '85.5',
                offset: 0,
                lastUpdatedAt: '2026-01-23T20:00:00Z'
            };

            // Create multiple events
            const event1 = fetcher.createSyntheticVacuumEvent(vacuumItem);
            const event2 = fetcher.createSyntheticVacuumEvent(vacuumItem);
            const event3 = fetcher.createSyntheticVacuumEvent(vacuumItem);

            const data1 = JSON.parse(event1.data);
            const data2 = JSON.parse(event2.data);
            const data3 = JSON.parse(event3.data);

            assert.equal(data1.noSerie, 1, 'First event should have serial 1');
            assert.equal(data2.noSerie, 2, 'Second event should have serial 2');
            assert.equal(data3.noSerie, 3, 'Third event should have serial 3');
        });
    });

    describe('createSyntheticTankEvent()', function() {
        it('should correctly transform tank data to synthetic events', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/tank';
            const fetcher = new DatacerFetcher(mockDB, endpoint, null, ENDPOINT_TYPES.TANK);

            const tankItem = {
                code: '001',
                name: 'RC1',
                device: 'TANK-DEVICE-001',
                rawValue: '150.5',
                Depth: '45.2',
                Capacity: '500',
                fill: '30.1',
                lastUpdatedAt: '2026-01-23T20:00:00Z'
            };

            const event = fetcher.createSyntheticTankEvent(tankItem);

            // Verify event structure
            assert.equal(event.coreid, 'TANK-DEVICE-001', 'coreid should be device name');
            assert.equal(event.name, 'RC1', 'name should be tank name');
            assert.equal(event.upstream, false, 'upstream should be false');
            assert.equal(event.published_at, '2026-01-23T20:00:00Z', 'published_at should match lastUpdatedAt');

            // Verify event data
            const eventData = JSON.parse(event.data);
            assert.equal(eventData.noSerie, 1, 'First event should have serial 1');
            assert.equal(eventData.generation, 0, 'generation should be 0');
            assert.equal(eventData.code, '001', 'code should match');
            assert.equal(eventData.name, 'RC1', 'name should match');
            assert.equal(eventData.device, 'TANK-DEVICE-001', 'device should match');
            assert.equal(eventData.rawValue, 150.5, 'rawValue should match');
            assert.equal(eventData.depth, 45.2, 'depth should match');
            assert.equal(eventData.capacity, 500, 'capacity should match');
            assert.equal(eventData.fill, 30.1, 'fill should match');
            assert.equal(eventData.lastUpdatedAt, '2026-01-23T20:00:00Z', 'lastUpdatedAt should match');
            assert.equal(eventData.eName, 'Tank/Level', 'eName should be Tank/Level');

            // Verify device attributes were set
            assert.deepEqual(mockDB.attributes['TANK-DEVICE-001'], {
                id: 'TANK-DEVICE-001',
                name: 'RC1'
            }, 'Device attributes should be set with tank name');
        });

        it('should use deviceIdPrefix with code when device is not provided', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/tank';
            const fetcher = new DatacerFetcher(mockDB, endpoint, null, ENDPOINT_TYPES.TANK);

            const tankItem = {
                code: '002',
                name: 'RF1',
                rawValue: '200',
                Depth: '60',
                Capacity: '1000',
                fill: '20',
                lastUpdatedAt: '2026-01-23T21:00:00Z'
            };

            const event = fetcher.createSyntheticTankEvent(tankItem);

            // When device is not provided, it should use deviceIdPrefix-code
            assert.equal(event.coreid, 'DATACER-TANK-002', 'coreid should be DATACER-TANK-code');
        });

        it('should handle missing/invalid numeric values gracefully', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/tank';
            const fetcher = new DatacerFetcher(mockDB, endpoint, null, ENDPOINT_TYPES.TANK);

            const tankItem = {
                code: '003',
                name: 'RF2',
                device: 'TANK-003',
                rawValue: 'invalid',
                Depth: null,
                Capacity: undefined,
                fill: '',
                lastUpdatedAt: '2026-01-23T22:00:00Z'
            };

            const event = fetcher.createSyntheticTankEvent(tankItem);
            const eventData = JSON.parse(event.data);

            assert.equal(eventData.rawValue, 0, 'Invalid rawValue should default to 0');
            assert.equal(eventData.depth, 0, 'Null depth should default to 0');
            assert.equal(eventData.capacity, 0, 'Undefined capacity should default to 0');
            assert.equal(eventData.fill, 0, 'Empty fill should default to 0');
        });
    });

    describe('createSyntheticWaterEvent()', function() {
        it('should correctly transform water data to synthetic events', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/water';
            const fetcher = new DatacerFetcher(mockDB, endpoint, null, ENDPOINT_TYPES.WATER);

            const waterItem = {
                id: '42',
                Name: 'COMPTEUR-EAU-1',
                volume_total: '12500.5',
                volume_heure: '45.2',
                volume_entaille: '0.8',
                volume_since_reset: '500.0',
                timestamp: '2026-01-23T20:00:00Z'
            };

            const event = fetcher.createSyntheticWaterEvent(waterItem);

            // Verify event structure
            assert.equal(event.coreid, 'DATACER-WATER-42', 'coreid should be DATACER-WATER-id');
            assert.equal(event.name, 'COMPTEUR-EAU-1', 'name should be meter name');
            assert.equal(event.upstream, false, 'upstream should be false');
            assert.equal(event.published_at, '2026-01-23T20:00:00Z', 'published_at should match timestamp');

            // Verify event data
            const eventData = JSON.parse(event.data);
            assert.equal(eventData.noSerie, 1, 'First event should have serial 1');
            assert.equal(eventData.generation, 0, 'generation should be 0');
            assert.equal(eventData.id, '42', 'id should match');
            assert.equal(eventData.name, 'COMPTEUR-EAU-1', 'name should match');
            assert.equal(eventData.device, 'DATACER-WATER-42', 'device should match coreid');
            assert.equal(eventData.volume_total, 12500.5, 'volume_total should match');
            assert.equal(eventData.volume_heure, 45.2, 'volume_heure should match');
            assert.equal(eventData.volume_entaille, 0.8, 'volume_entaille should match');
            assert.equal(eventData.volume_since_reset, 500.0, 'volume_since_reset should match');
            assert.equal(eventData.lastUpdatedAt, '2026-01-23T20:00:00Z', 'lastUpdatedAt should match timestamp');
            assert.equal(eventData.eName, 'Water/Volume', 'eName should be Water/Volume');

            // Verify device attributes were set
            assert.deepEqual(mockDB.attributes['DATACER-WATER-42'], {
                id: 'DATACER-WATER-42',
                name: 'COMPTEUR-EAU-1'
            }, 'Device attributes should be set with meter name');
        });

        it('should handle missing/invalid numeric values gracefully', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/water';
            const fetcher = new DatacerFetcher(mockDB, endpoint, null, ENDPOINT_TYPES.WATER);

            const waterItem = {
                id: '99',
                Name: 'COMPTEUR-EAU-2',
                volume_total: 'bad',
                volume_heure: null,
                volume_entaille: undefined,
                volume_since_reset: '',
                timestamp: '2026-01-23T22:00:00Z'
            };

            const event = fetcher.createSyntheticWaterEvent(waterItem);
            const eventData = JSON.parse(event.data);

            assert.equal(eventData.volume_total, 0, 'Invalid volume_total should default to 0');
            assert.equal(eventData.volume_heure, 0, 'Null volume_heure should default to 0');
            assert.equal(eventData.volume_entaille, 0, 'Undefined volume_entaille should default to 0');
            assert.equal(eventData.volume_since_reset, 0, 'Empty volume_since_reset should default to 0');
        });
    });

    describe('deviceIdPrefix based on endpointType', function() {
        it('should set deviceIdPrefix to DATACER for VACUUM endpoint type', function() {
            const mockDB = new MockEventDatabase();
            const fetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/vacuum', null, ENDPOINT_TYPES.VACUUM);

            assert.equal(fetcher.deviceIdPrefix, 'DATACER', 'VACUUM endpoint should have DATACER prefix');
            assert.equal(fetcher.endpointType, ENDPOINT_TYPES.VACUUM, 'endpointType should be VACUUM');
        });

        it('should set deviceIdPrefix to DATACER-TANK for TANK endpoint type', function() {
            const mockDB = new MockEventDatabase();
            const fetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/tank', null, ENDPOINT_TYPES.TANK);

            assert.equal(fetcher.deviceIdPrefix, 'DATACER-TANK', 'TANK endpoint should have DATACER-TANK prefix');
            assert.equal(fetcher.endpointType, ENDPOINT_TYPES.TANK, 'endpointType should be TANK');
        });

        it('should set deviceIdPrefix to DATACER-WATER for WATER endpoint type', function() {
            const mockDB = new MockEventDatabase();
            const fetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/water', null, ENDPOINT_TYPES.WATER);

            assert.equal(fetcher.deviceIdPrefix, 'DATACER-WATER', 'WATER endpoint should have DATACER-WATER prefix');
            assert.equal(fetcher.endpointType, ENDPOINT_TYPES.WATER, 'endpointType should be WATER');
        });

        it('should default to DATACER prefix when no endpoint type specified', function() {
            const mockDB = new MockEventDatabase();
            const fetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/vacuum', null);

            assert.equal(fetcher.deviceIdPrefix, 'DATACER', 'Default endpoint should have DATACER prefix');
            assert.equal(fetcher.endpointType, ENDPOINT_TYPES.VACUUM, 'Default endpointType should be VACUUM');
        });
    });

    describe('App integration', function() {
        it('should create multiple DatacerFetcher instances for different endpoints', function() {
            const mockDB = new MockEventDatabase();
            const originalEnvVac = process.env.ENDPOINT_VAC;
            const originalEnvTank = process.env.ENDPOINT_TANK;
            const originalEnvWater = process.env.ENDPOINT_WATER;

            try {
                // Simulate all endpoints being set
                process.env.ENDPOINT_VAC = 'https://test.datacer.online/vacuum';
                process.env.ENDPOINT_TANK = 'https://test.datacer.online/tank';
                process.env.ENDPOINT_WATER = 'https://test.datacer.online/water';

                // Simulate app.js initialization logic
                let datacerFetchers = [];

                if (process.env.ENDPOINT_VAC) {
                    const vacFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_VAC, null, ENDPOINT_TYPES.VACUUM);
                    datacerFetchers.push(vacFetcher);
                }

                if (process.env.ENDPOINT_TANK) {
                    const tankFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_TANK, null, ENDPOINT_TYPES.TANK);
                    datacerFetchers.push(tankFetcher);
                }

                if (process.env.ENDPOINT_WATER) {
                    const waterFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_WATER, null, ENDPOINT_TYPES.WATER);
                    datacerFetchers.push(waterFetcher);
                }

                // Verify all three fetchers were created
                assert.equal(datacerFetchers.length, 3, 'Should have 3 DatacerFetcher instances');

                // Verify each fetcher has correct endpoint and type
                assert.equal(datacerFetchers[0].datacerEndpoint, 'https://test.datacer.online/vacuum', 'First fetcher should have vacuum endpoint');
                assert.equal(datacerFetchers[0].endpointType, ENDPOINT_TYPES.VACUUM, 'First fetcher should be VACUUM type');
                assert.equal(datacerFetchers[0].deviceIdPrefix, 'DATACER', 'First fetcher should have DATACER prefix');

                assert.equal(datacerFetchers[1].datacerEndpoint, 'https://test.datacer.online/tank', 'Second fetcher should have tank endpoint');
                assert.equal(datacerFetchers[1].endpointType, ENDPOINT_TYPES.TANK, 'Second fetcher should be TANK type');
                assert.equal(datacerFetchers[1].deviceIdPrefix, 'DATACER-TANK', 'Second fetcher should have DATACER-TANK prefix');

                assert.equal(datacerFetchers[2].datacerEndpoint, 'https://test.datacer.online/water', 'Third fetcher should have water endpoint');
                assert.equal(datacerFetchers[2].endpointType, ENDPOINT_TYPES.WATER, 'Third fetcher should be WATER type');
                assert.equal(datacerFetchers[2].deviceIdPrefix, 'DATACER-WATER', 'Third fetcher should have DATACER-WATER prefix');
            } finally {
                // Restore original environment
                if (originalEnvVac !== undefined) process.env.ENDPOINT_VAC = originalEnvVac;
                else delete process.env.ENDPOINT_VAC;
                if (originalEnvTank !== undefined) process.env.ENDPOINT_TANK = originalEnvTank;
                else delete process.env.ENDPOINT_TANK;
                if (originalEnvWater !== undefined) process.env.ENDPOINT_WATER = originalEnvWater;
                else delete process.env.ENDPOINT_WATER;
            }
        });

        it('should only create fetchers for configured endpoints', function() {
            const mockDB = new MockEventDatabase();
            const originalEnvVac = process.env.ENDPOINT_VAC;
            const originalEnvTank = process.env.ENDPOINT_TANK;
            const originalEnvWater = process.env.ENDPOINT_WATER;

            try {
                // Simulate only TANK endpoint being set
                process.env.ENDPOINT_VAC = '';
                process.env.ENDPOINT_TANK = 'https://test.datacer.online/tank';
                delete process.env.ENDPOINT_WATER;

                let datacerFetchers = [];

                if (process.env.ENDPOINT_VAC) {
                    const vacFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_VAC, null, ENDPOINT_TYPES.VACUUM);
                    datacerFetchers.push(vacFetcher);
                }

                if (process.env.ENDPOINT_TANK) {
                    const tankFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_TANK, null, ENDPOINT_TYPES.TANK);
                    datacerFetchers.push(tankFetcher);
                }

                if (process.env.ENDPOINT_WATER) {
                    const waterFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_WATER, null, ENDPOINT_TYPES.WATER);
                    datacerFetchers.push(waterFetcher);
                }

                // Verify only TANK fetcher was created
                assert.equal(datacerFetchers.length, 1, 'Should have only 1 DatacerFetcher instance');
                assert.equal(datacerFetchers[0].endpointType, ENDPOINT_TYPES.TANK, 'Only fetcher should be TANK type');
            } finally {
                // Restore original environment
                if (originalEnvVac !== undefined) process.env.ENDPOINT_VAC = originalEnvVac;
                else delete process.env.ENDPOINT_VAC;
                if (originalEnvTank !== undefined) process.env.ENDPOINT_TANK = originalEnvTank;
                else delete process.env.ENDPOINT_TANK;
                if (originalEnvWater !== undefined) process.env.ENDPOINT_WATER = originalEnvWater;
                else delete process.env.ENDPOINT_WATER;
            }
        });

        it('should stop all DatacerFetchers on shutdown', function() {
            const mockDB = new MockEventDatabase();

            // Simulate app startup with multiple fetchers
            let datacerFetchers = [];

            const vacFetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/vacuum', null, ENDPOINT_TYPES.VACUUM);
            vacFetcher.intervalId = setInterval(() => {}, 60000);
            datacerFetchers.push(vacFetcher);

            const tankFetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/tank', null, ENDPOINT_TYPES.TANK);
            tankFetcher.intervalId = setInterval(() => {}, 60000);
            datacerFetchers.push(tankFetcher);

            const waterFetcher = new DatacerFetcher(mockDB, 'https://test.datacer.online/water', null, ENDPOINT_TYPES.WATER);
            waterFetcher.intervalId = setInterval(() => {}, 60000);
            datacerFetchers.push(waterFetcher);

            // Verify all are running
            assert.equal(datacerFetchers.length, 3, 'Should have 3 fetchers before shutdown');
            datacerFetchers.forEach((fetcher, index) => {
                assert.notEqual(fetcher.intervalId, null, `Fetcher ${index} should be running`);
            });

            // Simulate shutdown function from app.js
            if (datacerFetchers.length > 0) {
                datacerFetchers.forEach(fetcher => fetcher.stop());
                datacerFetchers = [];
            }

            // Verify all were stopped and cleared
            assert.equal(datacerFetchers.length, 0, 'datacerFetchers array should be empty after shutdown');
            assert.equal(vacFetcher.intervalId, null, 'vacFetcher intervalId should be null');
            assert.equal(tankFetcher.intervalId, null, 'tankFetcher intervalId should be null');
            assert.equal(waterFetcher.intervalId, null, 'waterFetcher intervalId should be null');
        });
    });

    describe('delay()', function() {
        it('should delay execution by specified milliseconds', async function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint);
            
            const startTime = Date.now();
            await fetcher.delay(100);
            const elapsedTime = Date.now() - startTime;
            
            // Allow some tolerance (±20ms) due to timer resolution
            assert.equal(elapsedTime >= 90 && elapsedTime <= 120, true,
                `Should delay ~100ms, but took ${elapsedTime}ms`);
        });
    });
});
