const firebase = require("./firebase");

/**
 * Creates a campaign and returns the new campaign document reference.
 * Campaign references stored on users intentionally contain only the
 * campaign id and whether the user is the DM.
 */
async function createCampaign({ name, icon = "ra-dragon", type = "campaign", dmUid = null }) {
    const campaignRef = firebase.db.collection("campaigns").doc();

    const campaignData = {
        icon,
        name,
        type
    };

    if (dmUid) {
        campaignData.DM = {
            id: dmUid,
            DM: true
        };
    }

    await campaignRef.set(campaignData);

    return campaignRef;
}

module.exports = {
    createCampaign
};
