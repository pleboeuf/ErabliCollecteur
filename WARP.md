# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview

ErabliCollecteur is a Node.js application that collects raw sensor data from Particle IoT devices. 
It connects to the Particle Cloud, listens for events from registered devices, and stores them in a SQLite database. 
A web server and WebSocket interface allows clients to query historical data and subscribe to real-time events.
ErabliCollecteur is one component of a data acquisition system consisting of three applications. The two other are ErabliDash and ErabliExport.

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
