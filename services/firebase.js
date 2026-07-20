const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("../credentials/serviceAccount.json");

initializeApp({
    credential: cert(serviceAccount),
});

module.exports = {
    auth: getAuth(),
    db: getFirestore()
};