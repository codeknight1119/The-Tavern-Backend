const firebase = require("./firebase");

/**
 * Creates a campaign and returns the new campaign document reference.
 */
async function createCampaign({ name, icon = "ra-dragon", type = "campaign" }) {
    const campaignRef = firebase.db.collection("campaigns").doc();

    await campaignRef.set({
        name,
        icon,
        type
    });

    return campaignRef;
}

module.exports = {
    createCampaign
};
