//
// Poll Spark Core devices for tank level readings.
//
var Promise = require('promise');
var http = require('https');
var fs = require('fs');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('erablipi.sqlite3');
var express = require('express');
var path = require('path');
var variableName = "niveau";
var tankLevelFile = "public/tank-levels.csv";
var accessToken = process.env.ACCESS_TOKEN;
var app = express();
app.use(app.router);
app.use(express.logger());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', express.static(path.join(__dirname, 'index.html')));
app.get('/tank/:name/levels.tsv', function(req, res) {
  console.log('Get ' + req.params.name);
  db.serialize(function() {
    db.all("select reading_date, gallons from tank_reading where device_name = ? and datetime(reading_date / 1000, 'unixepoch') >= date('now','-1 day') order by reading_date desc", [req.params.name], function(err, rows) {
      if (err) {
        console.log(err);
        return res.send(500, err);
      }
      var tsvRows = rows.map(function(row) { return [row.reading_date, row.gallons].join('\t') });
      var tsv = ['reading_date\tgallons'].concat(tsvRows);
      //console.log(tsv.join(', '));
      res.setHeader("Content-Type", "text/plain");
      res.send(tsv.join('\n'));
    });
  });
});

var tankIds = [
  process.env.TANK_1_DEVICE_ID,
  process.env.TANK_2_DEVICE_ID];

var tanks = {};
tanks[tankIds[0]] = { name:"JR1", tubeLength: 1847, height:1650, capacity:6500, type: "rond65"};
tanks[tankIds[1]] = { name:"JR2", tubeLength: 1375, height:1079, capacity: 900, type: "u42.5"};

var sampleSeconds = 10;

spark.login({accessToken: accessToken}).then(
  function(token){
    console.log('Login completed. Token: ', token);
    console.log("Getting " + tankIds.length + " tank devices: " + tankIds);
    Promise.all(tankIds.map(function(id) {
      return spark.getDevice(id);
    })).then(function(tanks) {
      console.log("Got " + tanks.length + " tank devices");
      var queryDevices = function() {
        tanks.forEach(function(tank) {
          update(tank);
        });
        setTimeout(queryDevices, sampleSeconds * 1000);
      }
      queryDevices();
    });
  },
  function(err) {
    console.log('Login failed: ', err);
  }
);

function update(device) {
  //console.log("Querying " + device.name);
  device.getVariable(variableName).then(
    function(data) {
      //console.log('Got result:', data);
      var deviceID = data.coreInfo.deviceID;
      console.log(device.name + "." + variableName + ": " + data.result);
      insertTankReading(deviceID, device.name, data.result, raw2gallons(data.result, deviceID));
    },
    function(err) {
      console.log('An error occurred while getting attrs:', err);
    }
  );
}

function raw2gallons(raw, tankId) {
  var tank = tanks[tankId];
  console.log("raw2gallons: " + raw + ", " + tankId + ", " + tank);
  var sampleHeight = tank.tubeLength - raw;
  var fillFactor = sampleHeight / tank.height;
  return tank.capacity * fillFactor;
}

function insertTankReading(deviceID, deviceName, rawReading, gallons) {
  db.serialize(function() {
    db.run("INSERT INTO tank_reading (device_id, device_name, reading_date, raw_reading, gallons) VALUES (?, ?, ?, ?, ?)",
        [ deviceID, deviceName, new Date(), rawReading, gallons.toFixed(0) ]);
  });
}

var http = require('http');
var port = process.env.PORT || '3000';
app.set('port', port);
var server = http.createServer(app);
server.listen(port);
console.log('Server started: http://localhost:' + port);

