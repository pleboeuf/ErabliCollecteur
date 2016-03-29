# ErabliWatchDog

## 1 - If not already done, make the file executable and own by root:
	sudo chmod +x watchDog.sh
 	sudo chown root watchDog.sh

## 2 - execute:
	screen -S watchDog  Create a screen session name watchdog
	sudo ./watchDog.sh  Start the watchdog
	^A d detach screen session
