require("dotenv").config();

const { BANNEDWORDS } = require("./bannedWords.js");

const firebase = require("./services/firebase");
const admin = require("firebase-admin");
const http = require("http");
const ngrok = require("@ngrok/ngrok");
const { exec } = require("child_process");

const PORT = process.env.PORT || 8080;

// ================================
// USER MANIFEST CACHE
// ================================

let userManifest = null;
let userManifestTimestamp = 0;

async function checkUserManifest() {
    try {
        const timestampSnapshot = await firebase.db
            .collection("manifest")
            .doc("userManifestTimestamp")
            .get();

        const remoteTimestamp = Number(
            timestampSnapshot.data()?.timestamp
        ) || 0;

        if (
            userManifest === null ||
            remoteTimestamp > userManifestTimestamp
        ) {
            const manifestSnapshot = await firebase.db
                .collection("manifest")
                .doc("userManifest")
                .get();

            const rawData = manifestSnapshot.data();

            userManifest = Array.isArray(rawData?.manifest)
                ? rawData.manifest
                : [];

            userManifestTimestamp = remoteTimestamp;

            console.log(
                `User manifest refreshed (${userManifest.length} users).`
            );
        }

        return userManifest;
    } catch (error) {
        console.error("User manifest error:", error);
        throw error;
    }
}

// ================================
// MANIFEST LOCATION MIGRATION
// ================================

async function migrateManifestLocations() {
    try {
        console.log("Starting manifest location migration...");

        const oldManifestRef = firebase.db
            .collection("users")
            .doc("userManifest");

        const oldTimestampRef = firebase.db
            .collection("users")
            .doc("userManifestTimestamp");

        const newManifestRef = firebase.db
            .collection("manifest")
            .doc("userManifest");

        const newTimestampRef = firebase.db
            .collection("manifest")
            .doc("userManifestTimestamp");

        const [manifestSnapshot, timestampSnapshot] = await Promise.all([
            oldManifestRef.get(),
            oldTimestampRef.get()
        ]);

        // Copy the manifest array explicitly instead of relying on the
        // entire source document object. This makes the migration clear and
        // lets us verify exactly how many entries were transferred.
        if (!manifestSnapshot.exists) {
            console.log("Old users/userManifest does not exist. Nothing to migrate.");
        } else {
            const sourceData = manifestSnapshot.data() || {};
            const sourceManifest = Array.isArray(sourceData.manifest)
                ? sourceData.manifest
                : [];

            await newManifestRef.set({
                ...sourceData,
                manifest: sourceManifest
            });

            const verifySnapshot = await newManifestRef.get();
            const migratedManifest = verifySnapshot.data()?.manifest;
            const migratedCount = Array.isArray(migratedManifest)
                ? migratedManifest.length
                : 0;

            if (migratedCount !== sourceManifest.length) {
                throw new Error(
                    `Manifest migration verification failed: source has ${sourceManifest.length} entries, new document has ${migratedCount}.`
                );
            }

            console.log(
                `Migrated users/userManifest -> manifest/userManifest (${sourceManifest.length} entries).`
            );
        }

        if (!timestampSnapshot.exists) {
            console.log("Old users/userManifestTimestamp does not exist. Nothing to migrate.");
        } else {
            const timestampData = timestampSnapshot.data() || {};

            await newTimestampRef.set(timestampData);

            console.log(
                "Migrated users/userManifestTimestamp -> manifest/userManifestTimestamp."
            );
        }

        console.log("Manifest location migration complete.");
    } catch (error) {
        console.error("Manifest location migration error:", error);
    }
}

// ================================
// USER DOCUMENT MIGRATION
// ================================

function convertUserDocument(data) {
    if (data.realName && data.realLastName && data.realFirstName && data.studentID) {
        return data;
    }

    const name = data["Real Name"] || data.name || "";
    const parts = name.split(" ");

    return {
        displayName: data.name || data["Real Name"] || "",
        realFirstName: parts[0] || "",
        realLastName: parts[1] || "",
        realName:
            data.realName ||
            data["Real Name"] || data.name || "",
        studentID: data.studentID || "-1",

        ...(data.campaigns !== undefined && {
            campaigns: data.campaigns
        })
    };
}

async function migrateUserDocuments() {
    try {
        console.log("Starting user document migration...");

        const snapshot = await firebase.db.collection("users").get();
        const excludedDocuments = new Set([
            "guestManifest",
            "userManifest",
            "userManifestTimestamp",
            "guestManifestTimestamp"
        ]);

        let migrated = 0;
        let skipped = 0;

        for (const doc of snapshot.docs) {
            if (excludedDocuments.has(doc.id)) {
                skipped++;
                continue;
            }

            const data = doc.data();
            const converted = convertUserDocument(data);

            await doc.ref.set(converted);
            migrated++;
        }

        console.log(
            `User document migration complete. Migrated: ${migrated}, skipped: ${skipped}.`
        );
    } catch (error) {
        console.error("User document migration error:", error);
    }
}

// ================================
// HTTP SERVER
// ================================

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(
            req.url,
            `http://${req.headers.host}`
        );

        console.log(`${req.method} ${url.pathname}`);

        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers":
                    "Content-Type, Authorization, ngrok-skip-browser-warning",
                "Access-Control-Max-Age": "86400"
            });

            return res.end();
        }

        if (req.method === "GET" && url.pathname === "/health") {
            return sendJSON(res, { message: "Server is active." });
        }

        const user = await authenticate(req);

        if (!user) {
            return unauthorized(res);
        }

        const params = url.searchParams;

        if (req.method === "GET") {
            switch (url.pathname) {
                case "/":
                    return sendJSON(res, {
                        message: "API works, try another route"
                    });

                case "/hello":
                    return sendJSON(res, {
                        message:
                            `Hello ${params.get("name") ?? "World"}!`
                    });

                case "/health":
                    return sendJSON(res, {
                        status: "Ready for another adventure!"
                    });

                default:
                    return notFound(res);
            }
        }

        if (req.method === "POST") {
            switch (url.pathname) {
                case "/getUserClaims": {
                    if (!user.permissions?.includes("officer")) {
                        return sendJSON(res, { error: "Unauthorized" }, 403);
                    }

                    try {
                        const body = await readBody(req);

                        if (!body || !body.uid) {
                            return sendJSON(res, { error: "uid is required" }, 400);
                        }

                        const targetUser = await firebase.auth.getUser(body.uid);
                        const claims = targetUser.customClaims || {};

                        return sendJSON(res, {
                            claims: {
                                allowed: claims.allowed === true,
                                permissions: Array.isArray(claims.permissions)
                                    ? claims.permissions
                                    : []
                            }
                        });
                    } catch (e) {
                        console.error("getUserClaims error:", e);
                        return sendJSON(res, { error: e.message || String(e) }, 500);
                    }
                }

                case "/getNotAllowedUsers": {
                    if (!user.permissions?.includes("officer")) {
                        return sendJSON(res, { error: "Unauthorized" }, 403);
                    }

                    try {
                        const manifest = await checkUserManifest();

                        if (manifest.length === 0) {
                            return sendJSON(res, []);
                        }

                        const manifestEntries = manifest
                            .map(entry => {
                                if (typeof entry === "string") return { id: entry };
                                if (entry && typeof entry.id === "string") return entry;
                                return null;
                            })
                            .filter(Boolean);

                        const uidRequests = manifestEntries.map(entry => ({ uid: entry.id }));
                        const notAllowedUsers = [];

                        for (let i = 0; i < uidRequests.length; i += 100) {
                            const batch = uidRequests.slice(i, i + 100);
                            const result = await firebase.auth.getUsers(batch);

                            const notAllowedAuthUsers = result.users.filter(authUser => {
                                const claims = authUser.customClaims || {};
                                return claims.allowed !== true;
                            });

                            if (notAllowedAuthUsers.length === 0) continue;

                            const profileRefs = notAllowedAuthUsers.map(authUser =>
                                firebase.db.collection("users").doc(authUser.uid)
                            );

                            const profileSnapshots = await firebase.db.getAll(...profileRefs);

                            for (let j = 0; j < notAllowedAuthUsers.length; j++) {
                                const authUser = notAllowedAuthUsers[j];
                                const profileSnapshot = profileSnapshots[j];
                                const profile = profileSnapshot.exists
                                    ? profileSnapshot.data()
                                    : {};
                                const claims = authUser.customClaims || {};

                                notAllowedUsers.push({
                                    id: authUser.uid,
                                    realName: profile.realName,
                                    duesPaid: profile.duesPaid ?? false,
                                    claims: {
                                        allowed: claims.allowed === true,
                                        permissions: Array.isArray(claims.permissions)
                                            ? claims.permissions
                                            : []
                                    }
                                });
                            }
                        }

                        return sendJSON(res, notAllowedUsers);
                    } catch (e) {
                        console.error("getNotAllowedUsers error:", e);
                        return sendJSON(res, { error: e.message || String(e) }, 500);
                    }
                }

                case "/setPermissions": {
                    if (!user.permissions?.includes("officer")) {
                        return sendJSON(res, { error: "Unauthorized" }, 403);
                    }

                    try {
                        const body = await readBody(req);

                        if (
                            !body ||
                            !body.uid ||
                            !Array.isArray(body.permissions) ||
                            typeof body.allowed !== "boolean"
                        ) {
                            return sendJSON(res, {
                                error: "uid, permissions, and allowed are required"
                            }, 400);
                        }

                        const targetUser = await firebase.auth.getUser(body.uid);
                        const existingClaims = targetUser.customClaims || {};

                        const updatedClaims = {
                            ...existingClaims,
                            allowed: body.allowed,
                            permissions: body.permissions
                        };

                        await firebase.auth.setCustomUserClaims(body.uid, updatedClaims);

                        return sendJSON(res, {
                            message: "Permissions have been updated",
                            allowed: body.allowed,
                            permissions: body.permissions
                        });
                    } catch (e) {
                        console.error("setPermissions error:", e);
                        return sendJSON(res, { error: e.message || String(e) }, 500);
                    }
                }

                case "/checkMessage": {
                    const body = await readBody(req);

                    if (!body || typeof body.message !== "string") {
                        return sendJSON(res, {
                            error: "A valid text message is required",
                            clean: false
                        });
                    }

                    const messageLower = body.message.toLowerCase();
                    const hasInappropriateContent = BANNEDWORDS.some(word =>
                        messageLower.includes(word.toLowerCase())
                    );

                    return sendJSON(res, { clean: !hasInappropriateContent });
                }

                case "/restart":
                case "/reset": {
                    if (!user.tech) {
                        return sendJSON(res, { error: "Not allowed" }, 403);
                    }

                    exec("git pull", (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Git pull error: ${error.message}`);
                            return sendJSON(res, { error: "Failed to pull updates" }, 500);
                        }

                        console.log(stdout);
                        if (stderr) console.error(stderr);

                        sendJSON(res, {
                            message: "Updates pulled. Restarting server with PM2."
                        });

                        setTimeout(() => {
                            exec("pm2 restart server.js", (restartError, restartStdout, restartStderr) => {
                                if (restartError) {
                                    console.error(`PM2 restart error: ${restartError.message}`);
                                    return;
                                }

                                console.log(restartStdout);
                                if (restartStderr) console.error(restartStderr);
                            });
                        }, 500);
                    });

                    return;
                }

                default:
                    return notFound(res);
            }
        }

        return notFound(res);
    } catch (err) {
        console.error("SERVER ERROR:");
        console.error(err);

        if (!res.headersSent) {
            res.writeHead(500, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
        }

        res.end(JSON.stringify({ error: "Internal server error" }));
    }
});

function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(data));
}

function unauthorized(res) {
    return sendJSON(res, { error: "Unauthorized access" }, 401);
}

function notFound(res) {
    return sendJSON(res, { error: "Endpoint not found." }, 404);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", () => {
            if (!body) return resolve(null);

            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });

        req.on("error", reject);
    });
}

async function authenticate(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.substring(7);

    try {
        return await firebase.auth.verifyIdToken(token);
    } catch (err) {
        console.error("Firebase authentication error:");
        console.error(err);
        return null;
    }
}

async function bootstrapAdmin() {
    const uid = "p1DqhQjZvBNWYkFuYJnYBGrbEa53";
    const targetUser = await firebase.auth.getUser(uid);
    const existingClaims = targetUser.customClaims || {};

    const updatedClaims = {
        ...existingClaims,
        allowed: true,
        permissions: [
            ...(Array.isArray(existingClaims.permissions)
                ? existingClaims.permissions
                : []),
            "officer",
            "tech"
        ]
    };

    updatedClaims.permissions = [...new Set(updatedClaims.permissions)];

    await firebase.auth.setCustomUserClaims(uid, updatedClaims);

    console.log("Admin claims updated for:", uid);
    console.log(updatedClaims);
}

server.listen(PORT, async () => {
    console.log(`Server listening on http://localhost:${PORT}`);
 //   await bootstrapAdmin();
    await migrateManifestLocations();
    // await migrateUserDocuments();
});
