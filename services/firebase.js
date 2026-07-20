const { initializeApp, cert } = require("firebase-admin/app");

const serviceAccount = require("../credentials/serviceAccount.json");
console.log(serviceAccount)
initializeApp({
    credential: cert(serviceAccount),
});

module.exports = admin;