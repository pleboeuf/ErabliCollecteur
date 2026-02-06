const assert = require('assert');
const { CommandHandler } = require('../command.js');

/**
 * Unit tests for CommandHandler query functionality
 * 
 * These tests cover:
 * 1. Query with limit parameter orders results in descending order
 * 2. Query without limit parameter orders results in ascending order
 * 3. Limit value is correctly passed to SQL query
 * 4. Limit parameter is correctly parsed from command
 */

// Mock database that captures SQL queries and parameters
class MockDatabase {
    constructor(rows = []) {
        this.rows = rows;
        this.lastSql = null;
        this.lastParams = null;
        this.closed = false;
    }

    prepare(sql) {
        this.lastSql = sql;
        const self = this;
        return {
            iterate(params) {
                self.lastParams = params;
                let index = 0;
                return {
                    next() {
                        if (index < self.rows.length) {
                            return { done: false, value: self.rows[index++] };
                        }
                        return { done: true };
                    }
                };
            }
        };
    }

    close() {
        this.closed = true;
    }
}

// Mock WebSocket connection that captures sent messages
class MockConnection {
    constructor() {
        this.messages = [];
        this.subscribed = false;
    }

    send(message, callback) {
        this.messages.push(JSON.parse(message));
        if (callback) callback();
    }
}

describe('CommandHandler', function() {
    describe('Query with limit parameter', function() {
        it('should order results in descending order when limit is provided', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device',
                limit: 10
            };

            handler.onCommand(command, connection);

            assert.ok(
                mockDb.lastSql.includes('order by generation_id desc, serial_no desc'),
                `SQL should contain descending order, got: ${mockDb.lastSql}`
            );
        });

        it('should correctly pass the limit value to the SQL query', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device',
                limit: 25
            };

            handler.onCommand(command, connection);

            assert.ok(
                mockDb.lastSql.includes('limit ?'),
                `SQL should contain limit placeholder, got: ${mockDb.lastSql}`
            );
            assert.ok(
                mockDb.lastParams.includes(25),
                `Params should include limit value 25, got: ${JSON.stringify(mockDb.lastParams)}`
            );
        });

        it('should apply limit as last parameter after device filter', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device',
                limit: 5
            };

            handler.onCommand(command, connection);

            // Device should be first param, limit should be last
            assert.equal(mockDb.lastParams[0], 'test-device', 'First param should be device');
            assert.equal(mockDb.lastParams[mockDb.lastParams.length - 1], 5, 'Last param should be limit');
        });
    });

    describe('Query without limit parameter', function() {
        it('should order results in ascending order when limit is not provided', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device'
            };

            handler.onCommand(command, connection);

            assert.ok(
                mockDb.lastSql.includes('order by generation_id, serial_no'),
                `SQL should contain ascending order, got: ${mockDb.lastSql}`
            );
            assert.ok(
                !mockDb.lastSql.includes('desc'),
                `SQL should NOT contain desc when no limit, got: ${mockDb.lastSql}`
            );
            assert.ok(
                !mockDb.lastSql.includes('limit'),
                `SQL should NOT contain limit clause, got: ${mockDb.lastSql}`
            );
        });
    });

    describe('Limit parameter parsing', function() {
        it('should correctly detect when limit parameter is present', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const commandWithLimit = {
                command: 'query',
                device: 'test-device',
                limit: 10
            };

            handler.onCommand(commandWithLimit, connection);
            const sqlWithLimit = mockDb.lastSql;

            const mockDb2 = new MockDatabase();
            const handler2 = CommandHandler(mockDb2, []);
            const connection2 = new MockConnection();

            const commandWithoutLimit = {
                command: 'query',
                device: 'test-device'
            };

            handler2.onCommand(commandWithoutLimit, connection2);
            const sqlWithoutLimit = mockDb2.lastSql;

            assert.notEqual(sqlWithLimit, sqlWithoutLimit, 'SQL should differ based on limit presence');
            assert.ok(sqlWithLimit.includes('limit'), 'SQL with limit should have limit clause');
            assert.ok(!sqlWithoutLimit.includes('limit'), 'SQL without limit should not have limit clause');
        });

        it('should handle limit value of 0', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device',
                limit: 0
            };

            handler.onCommand(command, connection);

            // limit: 0 is still a defined limit parameter
            assert.ok(
                mockDb.lastSql.includes('limit ?'),
                `SQL should contain limit even for 0, got: ${mockDb.lastSql}`
            );
            assert.ok(
                mockDb.lastParams.includes(0),
                `Params should include limit value 0, got: ${JSON.stringify(mockDb.lastParams)}`
            );
        });

        it('should not treat undefined limit as a limit parameter', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device',
                limit: undefined
            };

            handler.onCommand(command, connection);

            assert.ok(
                !mockDb.lastSql.includes('limit'),
                `SQL should NOT contain limit for undefined, got: ${mockDb.lastSql}`
            );
        });
    });

    describe('Query with all parameters including limit', function() {
        it('should build correct SQL with device, generation, after, and limit', function() {
            const mockDb = new MockDatabase();
            const handler = CommandHandler(mockDb, []);
            const connection = new MockConnection();

            const command = {
                command: 'query',
                device: 'test-device',
                generation: 5,
                after: 100,
                limit: 50
            };

            handler.onCommand(command, connection);

            assert.ok(mockDb.lastSql.includes('device_id = ?'), 'SQL should filter by device');
            assert.ok(mockDb.lastSql.includes('generation_id = ?'), 'SQL should filter by generation');
            assert.ok(mockDb.lastSql.includes('serial_no > ?'), 'SQL should filter by after');
            assert.ok(mockDb.lastSql.includes('order by generation_id desc, serial_no desc'), 'SQL should order descending');
            assert.ok(mockDb.lastSql.includes('limit ?'), 'SQL should have limit');

            assert.deepEqual(mockDb.lastParams, ['test-device', 100, 5, 50], 
                'Params should be in correct order: device, after, generation, limit');
        });
    });
});
