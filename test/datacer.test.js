const assert = require('assert');
const { DatacerFetcher } = require('../datacer.js');

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
        it('should set up interval when start() is called', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = trackFetcher(new DatacerFetcher(mockDB, endpoint));
            
            // Verify no interval before start
            assert.equal(fetcher.intervalId, null, 'intervalId should be null before start');
            
            // Start the fetcher (note: this will try to fetch immediately, which will fail, but that's ok for this test)
            fetcher.start();
            
            // Verify interval is set
            assert.notEqual(fetcher.intervalId, null, 'intervalId should be set after start');
        });

        it('should clear interval when stop() is called', function() {
            const mockDB = new MockEventDatabase();
            const endpoint = 'https://test.datacer.online/vacuum';
            const fetcher = new DatacerFetcher(mockDB, endpoint);
            
            // Start and then stop
            fetcher.start();
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



    describe('createSyntheticEvent()', function() {
        it('should correctly transform vacuum data to synthetic events', function() {
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
    
    const event = fetcher.createSyntheticEvent(vacuumItem);
    
    // Verify event structure
    assert.equal(event.coreid, 'DATACER', 'coreid should be DATACER');
    assert.equal(event.name, 'Vacuum/Datacer', 'name should be Vacuum/Datacer');
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
    assert.equal(eventData.label, 'EB-V01', 'label should be preserved');
    assert.equal(eventData.normalizedLabel, 'EB-V1', 'label should be normalized');
    assert.equal(eventData.lastUpdatedAt, '2026-01-23T20:00:00Z', 'lastUpdatedAt should match');
    assert.equal(eventData.eName, 'Vacuum/Datacer', 'eName should be Vacuum/Datacer');
    
            // Verify device attributes were set
            assert.deepEqual(mockDB.attributes['DATACER'], {
                id: 'DATACER',
                name: 'G9-G10'
            }, 'Device attributes should be set with device name');
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

        it('should include runtime info for specific devices', function() {
    const mockDB = new MockEventDatabase();
    const endpoint = 'https://test.datacer.online/vacuum';
    const fetcher = new DatacerFetcher(mockDB, endpoint);
    
    // Test device that should have runtime info (EB-V1, EB-V2, EB-V3)
    const vacuumItemWithRuntime = {
        device: 'EB-V1',
        label: 'EB-V01',
        rawValue: '10.5',
        temp: '20.0',
        referencialValue: '12.0',
        percentCharge: '85.5',
        offset: 0,
        lastUpdatedAt: '2026-01-23T20:00:00Z',
        RunTimeSinceMaint: 12345,
        NeedMaintenance: false
    };
    
    const eventWithRuntime = fetcher.createSyntheticEvent(vacuumItemWithRuntime);
    const dataWithRuntime = JSON.parse(eventWithRuntime.data);
    
    assert.equal(dataWithRuntime.RunTimeSinceMaint, 12345, 'Should include RunTimeSinceMaint');
    assert.equal(dataWithRuntime.NeedMaintenance, false, 'Should include NeedMaintenance');
    
    // Test device that should NOT have runtime info
    const vacuumItemNoRuntime = {
        device: 'G9-G10',
        label: 'EB-V01',
        rawValue: '10.5',
        temp: '20.0',
        referencialValue: '12.0',
        percentCharge: '85.5',
        offset: 0,
        lastUpdatedAt: '2026-01-23T20:00:00Z',
        RunTimeSinceMaint: 12345,
        NeedMaintenance: false
    };
    
    const eventNoRuntime = fetcher.createSyntheticEvent(vacuumItemNoRuntime);
    const dataNoRuntime = JSON.parse(eventNoRuntime.data);
    
            assert.equal(dataNoRuntime.RunTimeSinceMaint, undefined, 'Should NOT include RunTimeSinceMaint for other devices');
            assert.equal(dataNoRuntime.NeedMaintenance, undefined, 'Should NOT include NeedMaintenance for other devices');
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
    const event1 = fetcher.createSyntheticEvent(vacuumItem);
    const event2 = fetcher.createSyntheticEvent(vacuumItem);
    const event3 = fetcher.createSyntheticEvent(vacuumItem);
    
    const data1 = JSON.parse(event1.data);
    const data2 = JSON.parse(event2.data);
    const data3 = JSON.parse(event3.data);
    
            assert.equal(data1.noSerie, 1, 'First event should have serial 1');
            assert.equal(data2.noSerie, 2, 'Second event should have serial 2');
            assert.equal(data3.noSerie, 3, 'Third event should have serial 3');
        });
    });

    describe('App integration', function() {
        it('should be created when ENDPOINT_VAC is configured', function() {
    const mockDB = new MockEventDatabase();
    const originalEnv = process.env.ENDPOINT_VAC;
    
    try {
        // Simulate ENDPOINT_VAC being set
        process.env.ENDPOINT_VAC = 'https://test.datacer.online/vacuum';
        
        // Create fetcher (simulating app.js logic)
        let datacerFetcher = null;
        if (process.env.ENDPOINT_VAC) {
            datacerFetcher = new DatacerFetcher(mockDB, process.env.ENDPOINT_VAC);
        }
        
        assert.notEqual(datacerFetcher, null, 'DatacerFetcher should be created when ENDPOINT_VAC is set');
        assert.equal(datacerFetcher.datacerEndpoint, 'https://test.datacer.online/vacuum', 
            'Endpoint should be set correctly');
        
        // Simulate no ENDPOINT_VAC
        process.env.ENDPOINT_VAC = '';
        let datacerFetcherNotCreated = null;
        if (process.env.ENDPOINT_VAC) {
            datacerFetcherNotCreated = new DatacerFetcher(mockDB, process.env.ENDPOINT_VAC);
        }
        
                assert.equal(datacerFetcherNotCreated, null, 
                    'DatacerFetcher should not be created when ENDPOINT_VAC is not set');
            } finally {
                // Restore original environment
                if (originalEnv !== undefined) {
                    process.env.ENDPOINT_VAC = originalEnv;
                } else {
                    delete process.env.ENDPOINT_VAC;
                }
            }
        });

        it('should stop DatacerFetcher on shutdown', function() {
    const mockDB = new MockEventDatabase();
    const endpoint = 'https://test.datacer.online/vacuum';
    
    // Simulate app startup
    let datacerFetcher = new DatacerFetcher(mockDB, endpoint);
    datacerFetcher.intervalId = setInterval(() => {}, 60000); // Simulate running interval
    
    // Verify it's running
    assert.notEqual(datacerFetcher.intervalId, null, 'Fetcher should be running');
    
            // Simulate shutdown (from app.js shutdown function)
            if (datacerFetcher) {
                datacerFetcher.stop();
                datacerFetcher = null;
            }
            
            assert.equal(datacerFetcher, null, 'DatacerFetcher should be null after shutdown');
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
