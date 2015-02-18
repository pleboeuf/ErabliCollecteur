//
// Poll Spark Core devices for tank level readings.
//
// If the CSV format changes, it can be re-generated from the database:
//
//   # sqlite3 erablipi.sqlite3 -separator $'\t' 'select reading_date, raw_reading, gallons from tank_reading' > jauge.csv
//
var http = require('https');
var fs = require('fs');
var spark = require('spark');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('erablipi.sqlite3');
var variableName = "dist";

var accessToken = process.env.ACCESS_TOKEN;

spark.login({accessToken: accessToken}).then(
  function(token){
    console.log('Login completed. Token: ', token);
    queryDevices();
  },
  function(err) {
    console.log('Login failed: ', err);
  }
);

function queryDevices() {
  spark.devices.forEach(function(device) {
    update(device);
  });
  setTimeout(queryDevices, 5000);
}

function update(device) {
  device.getVariable(variableName).then(
    function(data) {
      //console.log('Got result:', data);
      var deviceID = data.coreInfo.deviceID;
      console.log('Raw level for ' + deviceID + ": " + data.result);
      insertTankReading(deviceID, data.result, -1);
      appendTankReadingCSV(deviceID, data.result, -1);
    },
    function(err) {
      console.log('An error occurred while getting attrs:', err);
    }
  );
}

function insertTankReading(deviceID, rawReading, gallons) {
  db.serialize(function() {
    db.run("INSERT INTO tank_reading (device_id, reading_date, raw_reading, gallons) VALUES (?, ?, ?, ?)",
        [ deviceID, new Date(), rawReading, gallons ]);
  });
}

function appendTankReadingCSV(deviceID, rawReading, gallons) {
  var timestamp = new Date().getTime();
  fs.appendFile("tank-levels.csv", ["" + timestamp, rawReading, gallons].join("\t") + "\n", function(err) {
    if (err) {
      console.log(err);
    }
  });
}


