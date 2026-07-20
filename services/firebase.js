const admin = require("firebase-admin");

console.log(admin)

const serviceAccount = require("../credentials/serviceAccount.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;