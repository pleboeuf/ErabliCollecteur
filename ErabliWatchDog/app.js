var exec = require('child_process').exec;
var fs = require("fs"); //Load the filesystem module
var myFile = "/home/erabliere/ErabliCollecteur/raw_events.sqlite3";
var firstRunFlag = true;
var lastFileSize = 0;
var maxDelay = 0;
const timeoutLimit = 300; // 5 minutes

var interval = setInterval(function(){
	var stats = fs.statSync(myFile);
	var fileSizeInBytes = stats["size"];
	var modTime = stats["mtime"];
	var date = new Date(modTime);
	var fileTime = date.getTime() / 1000;
	var now = new Date().getTime() / 1000;
	var dt = (firstRunFlag ? 0 : now - fileTime).toFixed(0);
	maxDelay = (firstRunFlag ? 0 : Math.max(maxDelay, dt));
//	console.log("File size is: " + fileSizeInBytes + ", Last mod. : " + modTime + ", dt: " + dt + " sec." + ", max delay: " + maxDelay + " sec.");
	if (dt > timeoutLimit && !firstRunFlag){
		console.log("Attention: Le collecteur de données à cessez de fonctionner!!!" + ", Last mod. : " + modTime);
                console.log("Re-demarrage du collecteur...");
		restartCollecteur();
		maxDelay = 0;
	}
	lastFileSize = fileSizeInBytes;
	firstRunFlag = false;
}, 10000);

function restartCollecteur(){
	var child = exec('sudo /etc/init.d/ErabliCollecteur restart --force', function(error, stdout, stderr) {
		if (error) console.log(error);
		process.stdout.write(stdout);
		process.stderr.write(stderr);
		return 0;
	});
}

