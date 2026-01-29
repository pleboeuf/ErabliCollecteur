# ErabliCollecteur Test Suite

This directory contains unit tests for the ErabliCollecteur application.

## Running Tests

```bash
# Run all tests
npm test

# Run only DatacerFetcher tests
npm run test:datacer

# Run specific test file
npx mocha test/datacer.test.js

# Run with verbose output
npx mocha test/datacer.test.js --reporter spec
```

## Test Files

### datacer.test.js

Comprehensive unit tests for the `DatacerFetcher` class that handles polling of the Datacer API and transformation of vacuum sensor data into Particle-compatible events.

#### Test Coverage

**1. Polling Behavior**
- ✅ `start()` sets up a 60-second interval for API polling
- ✅ `stop()` clears the interval and stops polling

**2. Data Fetching (`fetchDatacerData()`)**
- ✅ Returns `null` on network errors (graceful error handling)
- ✅ Handles invalid/unreachable endpoints

**3. Event Transformation (`createSyntheticEvent()`)**
- ✅ Correctly transforms Datacer vacuum data to Particle-like event structure
- ✅ Sets correct event fields: `coreid`, `name`, `published_at`, `data`, `upstream`
- ✅ Transforms vacuum sensor data: `rawValue` → `eData`, `referencialValue` → `ref`
- ✅ Preserves device information and metadata

**4. Label Normalization (`normalizeLabel()`)**
- ✅ Removes leading zeros from labels (e.g., "EB-V01" → "EB-V1")
- ✅ Handles various label formats correctly
- ✅ Preserves non-zero-padded labels (e.g., "EB-V10" → "EB-V10")

**5. Runtime Information**
- ✅ Includes `RunTimeSinceMaint` and `NeedMaintenance` for specific devices (EB-V1, EB-V2, EB-V3)
- ✅ Excludes runtime fields for other devices

**6. Serial Number Tracking**
- ✅ Increments `noSerie` for each event created
- ✅ Maintains sequential serial numbers across multiple events

**7. App Integration**
- ✅ DatacerFetcher is created when `ENDPOINT_VAC` environment variable is set
- ✅ DatacerFetcher is not created when `ENDPOINT_VAC` is absent
- ✅ `stop()` is called during app shutdown to clean up resources

**8. Delay Mechanism**
- ✅ `delay()` method properly delays execution by specified milliseconds
- ✅ Supports delaying between event emissions to avoid saturating downstream modules

### test.js

Legacy tests using the `expresso` framework. These tests cover:
- EventDatabase event handling
- Command handler query processing
- Basic event validation

**Note:** These tests use an older testing style. Consider migrating to Mocha format for consistency.

## Test Framework

- **Framework:** Mocha
- **Assertion Library:** Node.js built-in `assert`
- **Test Runner:** npm scripts or direct `mocha` invocation

## Writing New Tests

When adding new tests:

1. Use the Mocha `describe`/`it` syntax
2. Group related tests in `describe` blocks
3. Use `beforeEach`/`afterEach` for test setup/cleanup
4. Clean up resources (intervals, timers, connections) in cleanup hooks
5. Use descriptive test names that explain what is being tested

Example:

```javascript
describe('MyModule', function() {
    let instance;

    beforeEach(function() {
        instance = new MyModule();
    });

    afterEach(function() {
        instance.cleanup();
    });

    it('should do something specific', function() {
        assert.equal(instance.doThing(), expectedResult);
    });
});
```

## Test Utilities

### MockEventDatabase

A mock implementation of `EventDatabase` used in tests:

```javascript
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
```

### Cleanup Helpers

Tests use `trackFetcher()` and `cleanupFetchers()` to ensure proper cleanup:

```javascript
const fetcher = trackFetcher(new DatacerFetcher(mockDB, endpoint));
// Test code...
// Cleanup happens automatically in afterEach()
```

## Future Improvements

- Add mocking library (e.g., `nock`, `sinon`) for more comprehensive network call mocking
- Add integration tests that test the full data flow from Datacer API to database
- Migrate legacy tests from `expresso` to Mocha
- Add code coverage reporting (e.g., `nyc`, `istanbul`)
- Add continuous integration (CI) configuration
