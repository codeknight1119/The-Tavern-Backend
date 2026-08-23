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
            .collection("users")
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
                .collection("users")
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
// HTTP SERVER
// ================================

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(
            req.url,
            `http://${req.headers.host}`
        );

        console.log(`${req.method} ${url.pathname}`);

        // ================================
        // CORS PREFLIGHT
        // ================================

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

        // ================================
        // AUTHENTICATION
        // ================================

        if (req.method === "GET" && url.pathname === "/health") {
            return sendJSON(res, { message: "Server is active." });
        }

        const user = await authenticate(req);

        if (!user) {
            return unauthorized(res);
        }

        const params = url.searchParams;

        // ================================
        // GET
        // ================================

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

        // ================================
        // POST
        // ================================

        if (req.method === "POST") {
            switch (url.pathname) {

                // ================================
                // GET A USER'S AUTH CLAIMS
                // ================================

                case "/getUserClaims": {
                    if (!user.permissions?.includes("officer")) {
                        return sendJSON(res, {
                            error: "Unauthorized"
                        }, 403);
                    }

                    try {
                        const body = await readBody(req);

                        if (!body || !body.uid) {
                            return sendJSON(res, {
                                error: "uid is required"
                            }, 400);
                        }

                        const targetUser = await admin.auth().getUser(body.uid);
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

                        return sendJSON(res, {
                            error: e.message || String(e)
                        }, 500);
                    }
                }

                // ================================
                // GET ALL NOT-ALLOWED USERS
                // ================================

                case "/getNotAllowedUsers": {
                    if (!user.permissions?.includes("officer")) {
                        return sendJSON(res, {
                            error: "Unauthorized"
                        }, 403);
                    }

                    try {
                        const manifest = await checkUserManifest();

                        if (manifest.length === 0) {
                            return sendJSON(res, []);
                        }

                        const uidRequests = manifest
                            .filter(uid => typeof uid === "string" && uid.length > 0)
                            .map(uid => ({ uid }));

                        const notAllowedUsers = [];

                        // Firebase Auth accepts at most 100 users per getUsers call.
                        for (let i = 0; i < uidRequests.length; i += 100) {
                            const batch = uidRequests.slice(i, i + 100);
                            const result = await admin.auth().getUsers(batch);

                            const notAllowedAuthUsers = result.users.filter(
                                authUser => {
                                    const claims = authUser.customClaims || {};
                                    return claims.allowed !== true;
                                }
                            );

                            if (notAllowedAuthUsers.length === 0) {
                                continue;
                            }

                            // Fetch the corresponding Firestore profile documents
                            // so the frontend can render the same user-search template.
                            const profileRefs = notAllowedAuthUsers.map(
                                authUser =>
                                    firebase.db.collection("users").doc(authUser.uid)
                            );

                            const profileSnapshots =
                                await firebase.db.getAll(...profileRefs);

                            for (let j = 0; j < notAllowedAuthUsers.length; j++) {
                                const authUser = notAllowedAuthUsers[j];
                                const profileSnapshot = profileSnapshots[j];
                                const profile = profileSnapshot.exists
                                    ? profileSnapshot.data()
                                    : {};
                                const claims = authUser.customClaims || {};

                                notAllowedUsers.push({
                                    id: authUser.uid,
                                    "Real Name": profile["Real Name"] || "Unknown",
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

                        return sendJSON(res, {
                            error: e.message || String(e)
                        }, 500);
                    }
                }

                // ================================
                // SET A USER'S AUTH CLAIMS
                // ================================

                case "/setPermissions": {
                    if (!user.permissions?.includes("officer")) {
                        return sendJSON(res, {
                            error: "Unauthorized"
                        }, 403);
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

                        const targetUser = await admin.auth().getUser(body.uid);
                        const existingClaims = targetUser.customClaims || {};

                        const updatedClaims = {
                            ...existingClaims,
                            allowed: body.allowed,
                            permissions: body.permissions
                        };

                        await admin.auth().setCustomUserClaims(
                            body.uid,
                            updatedClaims
                        );

                        return sendJSON(res, {
                            message: "Permissions have been updated",
                            allowed: body.allowed,
                            permissions: body.permissions
                        });
                    } catch (e) {
                        console.error("setPermissions error:", e);

                        return sendJSON(res, {
                            error: e.message || String(e)
                        }, 500);
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

                    return sendJSON(res, {
                        clean: !hasInappropriateContent
                    });
                }

                // Restart/reset the server through PM2 after pulling the latest code.
                case "/restart":
                case "/reset": {
                    if (!user.tech) {
                        return sendJSON(res, { error: "Not allowed" }, 403);
                    }

                    exec("git pull", (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Git pull error: ${error.message}`);
                            return sendJSON(res, {
                                error: "Failed to pull updates"
                            }, 500);
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

        res.end(JSON.stringify({
            error: "Internal server error"
        }));
    }
});

// ================================
// SEND JSON
// ================================

function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(data));
}

// ================================
// UNAUTHORIZED
// ================================

function unauthorized(res) {
    return sendJSON(
        res,
        {
            error: "Unauthorized access"
        },
        401
    );
}

// ================================
// NOT FOUND
// ================================

function notFound(res) {
    return sendJSON(
        res,
        {
            error: "Endpoint not found."
        },
        404
    );
}

// ================================
// READ POST BODY
// ================================

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", () => {
            if (!body) {
                return resolve(null);
            }

            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });

        req.on("error", reject);
    });
}

// ================================
// FIREBASE AUTHENTICATION
// ================================

async function authenticate(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return null;
    }

    if (!authHeader.startsWith("Bearer ")) {
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

// ================================
// START SERVER
// ================================

server.listen(PORT, async () => {
    console.log(
        `Server listening on http://localhost:${PORT}`
    );

    try {
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken_from_env: true
        });

        console.log(
            `Tunnel: ${listener.url()}`
        );
    } catch (error) {
        console.error(
            "❌ Ngrok failed to initialize."
        );

        console.error(
            "Make sure NGROK_AUTHTOKEN is active in your .env file."
        );

        console.error(
            `Reason: ${error.message}`
        );
    }
});