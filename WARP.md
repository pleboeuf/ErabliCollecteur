# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview

ErabliCollecteur is a Node.js application that collects raw sensor data from Particle IoT devices.
It connects to the Particle Cloud, listens for events from registered devices, and stores them in a SQLite database. 
A web server and WebSocket interface allows clients to query historical data and subscribe to real-time events.

## System Architecture

ErabliCollecteur is the data ingestion component of a three-part IoT data acquisition system:

**1. ErabliCollecteur (this application)** - Data Collection Layer
- Connects to Particle Cloud and receives raw sensor events from IoT devices
- Stores raw events in SQLite database (raw_events.sqlite3)
- Exposes WebSocket server (default port: 8150) for real-time event streaming
- Provides HTTP REST API for historical data queries
- Acts as the central event hub that downstream applications connect to

**2. ErabliDash** - Data Visualization Layer
- Connects to ErabliCollecteur via WebSocket client (ws://localhost:8150/)
- Queries historical data on startup, then subscribes to real-time events
- Processes raw sensor data into human-readable dashboard metrics
- Serves web dashboard (default port: 3300) with live updates
- Broadcasts processed data to browser clients via its own WebSocket server

**3. ErabliExport** - Data Persistence & Export Layer
- Connects to ErabliCollecteur via WebSocket client (ws://localhost:8150/)
- Queries historical data on startup, then subscribes to real-time events
- Processes and stores sensor readings in normalized SQLite tables (pumps, cycles, coulee)
- Exports data to InfluxDB time-series database for long-term analytics
- Provides web interface (default port: 3003) for CSV exports

### Data Flow Between Components

```
Particle Cloud
     ↓
ErabliCollecteur (port 8150)
  │
  ├─→ WebSocket stream → ErabliDash (port 3300) → Browser clients
  │
  └─→ WebSocket stream → ErabliExport (port 3003) → InfluxDB
```

Both ErabliDash and ErabliExport:
1. Send `{"command": "query", ...}` to retrieve historical events on startup
2. Send `{"command": "subscribe"}` to receive real-time events
3. Automatically reconnect if connection drops
4. Process the same raw event stream but for different purposes (visualization vs. persistence)

## Architecture

### Core Components

**app.js** - Main application entry point
- Connects to Particle Cloud using credentials from environment variables (PARTICLE_USER, PARTICLE_TOKEN)
- Manages SQLite database lifecycle (creation, connections, graceful shutdown)
- Runs Express HTTP server (default port: 8150)
- Manages WebSocket server for real-time event streaming
- Implements inactivity timeout (150s) that triggers graceful shutdown
- Handles device replay requests via Particle Cloud functions

**event.js** - EventDatabase class
- Processes incoming events from Particle devices
- Validates events contain required fields (noSerie, generation, eData)
- Handles duplicate detection using device_id, generation_id, and serial_no
- Maintains device attributes (name, ID mapping)
- Notifies registered listeners (WebSocket clients) of new events

**command.js** - CommandHandler class
- Processes WebSocket commands from clients: "query" and "subscribe"
- Executes queries against SQLite database with optional filters (device, generation, after)
- Implements blacklist filtering based on config.json
- Opens read-only database connections per query (closed after query completion)

### Data Flow

1. **Particle Cloud → EventDatabase**: Events arrive via Particle stream → validated → deduplicated → inserted to database → broadcast to subscribed WebSocket clients
2. **Client → WebSocket Server**: Clients send JSON commands ("query" or "subscribe") → CommandHandler executes queries → results streamed back as JSON events
3. **HTTP Endpoint**: GET `/device/:id?generation=X&since=Y` returns historical events as JSON array

### Database Schema

SQLite table `raw_events`:
- device_id: Particle device identifier (24 char)
- published_at: Event timestamp
- raw_data: JSON string containing event payload
- generation_id: Device generation counter (resets on firmware updates)
- serial_no: Sequential event number within a generation

### Configuration

**config.json** (copy from config.json.sample):
- port: HTTP/WebSocket server port (default: 8150)
- database: SQLite database file path
- streamTimeout: Particle stream timeout in milliseconds
- collectors: Array of collector URIs for data forwarding
- mariadb: Optional MariaDB configuration
- blacklist: Array of devices/timestamps to filter out

**Environment variables** (.env):
- PARTICLE_USER: Particle Cloud account email
- PARTICLE_TOKEN: Particle Cloud access token (not password)
- DB_HOST, DB_USER, DB_PASSWORD, DB_DB: Optional MariaDB credentials

## Development Commands

### Setup
```bash
# Install dependencies
npm install

# Create database from schema if not already present
sqlite3 raw_events.sqlite3 < schema.sql

# Configure credentials
cp config.json.sample config.json
# Edit config.json and .env with your Particle credentials
```

### Running the Application
```bash
# Normal mode - connects to Particle Cloud and streams events
node app.js

# Playback mode with options
node app.js noStream              # Skip Particle Cloud connection
node app.js noStream allDeviceReplay  # Replay all events from database on start
```

### Testing
```bash
# Install test framework (if not already installed)
sudo npm install -g expresso

# Run tests
expresso
```

### Docker
```bash
# Build image (includes your config.json)
docker build -t elecnix/erablicollecteur .

# Run container
docker run -d --volume=$(pwd)/data:/data -p 8150:8150 elecnix/erablicollecteur
```

### Systemd Service (Linux production)
```bash
# Service file location: ErabliCollecteur.service
# Runs as user 'erabliere' with PID file tracking
sudo systemctl enable ErabliCollecteur.service
sudo systemctl start ErabliCollecteur.service
sudo systemctl status ErabliCollecteur.service
```

## Important Implementation Details

### Database Connection Management
- Main database connection stored in `mainDbConnection` (closed on graceful shutdown)
- HTTP request handlers open read-only connections per request
- WebSocket command handlers open read-only connections per query
- command.js is responsible for closing query connections after completion

### Graceful Shutdown
Application responds to SIGTERM/SIGINT by:
1. Clearing inactivity timer
2. Closing Particle event stream
3. Closing WebSocket server
4. Closing database connection
5. Exiting with code 0

### Event Deduplication
Events are uniquely identified by (device_id, generation_id, serial_no). Duplicates are logged but not stored. Non-replay duplicates trigger warnings about possible data loss.

### Device Replay Mechanism
When starting with `allDeviceReplay`, the app requests each device to replay events from the last known serial number for the latest generation. The Particle device must have a "replay" function that accepts arguments in format: `serialNo,generationId`.

### WebSocket Protocol
Clients send JSON commands:
```json
{"command": "subscribe"}
{"command": "query", "device": "device-id", "generation": 0, "after": 0}
```

Server sends JSON events:
```json
{
  "coreid": "device-id",
  "published_at": "2016-01-17T17:17:18.370Z",
  "name": "event-name",
  "data": "{\"noSerie\": 123, \"generation\": 0, ...}"
}
```

Query completion:
```json
{"name": "collector/querycomplete", "data": {...}}
```

### Node.js Version
Requires Node.js >= 22.11.0 (specified in package.json engines)

## Integration with Other Components

### ErabliDash Integration
ErabliDash connects to ErabliCollecteur as a WebSocket client using the `websocket` npm package. Configure the collector URI in ErabliDash's config.json:
```json
{
  "collectors": [{"uri": "ws://localhost:8150/"}]
}
```

On startup, ErabliDash:
1. Connects to ErabliCollecteur's WebSocket server
2. Sends query commands to fetch historical events from the last known state
3. Waits for `collector/querycomplete` event
4. Subscribes to real-time events
5. Transforms raw events into dashboard-specific data structures
6. Serves processed data to browser clients on port 3300

### ErabliExport Integration
ErabliExport also connects as a WebSocket client with similar flow to ErabliDash. Configure in ErabliExport's config.json:
```json
{
  "collectors": [{"uri": "ws://localhost:8150/"}],
  "dashboardConfig": {"filename": "../ErabliDash/config.json"}
}
```

On startup, ErabliExport:
1. Loads ErabliDash's configuration to access device definitions
2. Connects to ErabliCollecteur's WebSocket server
3. Queries historical events from last processed state
4. Subscribes to real-time events after query completion
5. Processes events into normalized database tables (pumps, cycles, coulee)
6. Exports processed data to InfluxDB at configured intervals

Note: ErabliExport can run in playback mode (`node app playbackOnly`) to process historical data without subscribing to real-time events.

## Deployment Considerations

### Typical Deployment Topology
For production deployments, all three components typically run on the same host:
- ErabliCollecteur runs as a systemd service (ErabliCollecteur.service)
- ErabliDash and ErabliExport run as separate services or containers
- All three share localhost networking (ws://localhost:8150)

### Docker Deployment
When deploying with Docker, use container linking or Docker Compose networking:
```bash
# Start collector
docker run -d --name erablicollecteur -p 8150:8150 elecnix/erablicollecteur

# Link dash to collector
docker run -d --name erablidash -p 3300:3300 --link erablicollecteur:erablicollecteur elecnix/erablidash

# Link export to collector
docker run -d --name erabliexport -p 3003:3003 --link erablicollecteur:erablicollecteur elecnix/erabliexport
```

When using Docker links, set the collector hostname in downstream configs to the container name (e.g., `ws://erablicollecteur:8150/`).

### High Availability Notes
- ErabliCollecteur is the single point of failure - if it goes down, both downstream components will attempt reconnection
- Raw events are persisted in SQLite before broadcasting, ensuring no data loss if downstream components are offline
- Downstream components automatically reconnect and query missing events on reconnection
- Each component maintains its own state file (dashboard.json for ErabliDash) to track last processed event
