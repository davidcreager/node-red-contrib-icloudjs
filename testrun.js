const iCloud = require('icloudjs').default;
const path = require("path");
const icloud = new iCloud({
    username: "dcreager@btinternet.com",
    password: "Crispy10!",
    saveCredentials: true,
    trustDevice: true,
	dataDirectory: path.resolve('./tmp/')
});
( async () => {
	await icloud.authenticate()
	console.log(icloud.status)
	if (icloud.status === "MfaRequested") {
		await icloud.provideMfaCode("094508")
	}
	await icloud.awaitReady;
	console.log("Hello, " + icloud.accountInfo.dsInfo.fullName)
	const findMyService = icloud.getService("findme");
	await findMyService.refresh();
	for (let device of findMyService.devices.values()) {
		let lin="";
		if (device.deviceInfo.batteryLevel != 0) {
			console.log(device.deviceInfo.name + "\t" + Math.floor(device.deviceInfo.batteryLevel * 100) + "% " + device.deviceInfo.batteryStatus);
			console.log(JSON.stringify(device.deviceInfo));
			console.log(Object.keys(device.deviceInfo).map( key => key + ":" + device.deviceInfo[key] ).join(","));
		}
		//console.log(device.deviceInfo.name + "\t" + Math.floor(device.deviceInfo.batteryLevel * 100) + "% " + device.deviceInfo.batteryStatus);
	}
})();
