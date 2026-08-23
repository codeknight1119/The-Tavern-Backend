require("dotenv").config();

const {BANNEDWORDS} = require("./bannedWords.js")

const firebase = require("./services/firebase");
const admin = require('firebase-admin');
const http = require("http");
const ngrok = require("@ngrok/ngrok");
const { exec } = require("child_process");

const PORT = process.env.PORT || 8080;


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

        if(req.method === "GET" && url.pathname === "/health"){
            return sendJSON(res, {message:"Server is active."})
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
                        //tavern themed. ik im a great dev
                    })


                default:
                    return notFound(res);
            }
        }


        // ================================
        // POST
        // ================================

        if (req.method === "POST") {

            switch (url.pathname) {

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
                            message: "Permissions have been updated"
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

                // 1. Safety check: prevent the server from crashing if 'message' is missing
                if (!body || typeof body.message !== 'string') {
                    return sendJSON(res, { 
                        error: "A valid text message is required",
                        clean: false 
                    });
                }

                // 2. Convert the message to lowercase so "BadWord" and "badword" are treated the same
                const messageLower = body.message.toLowerCase();

                // 3. Check against the banned words list
                const hasInappropriateContent = BANNEDWORDS.some(word => 
                    messageLower.includes(word.toLowerCase())
                );

                // 4. Return the corrected logic
                return sendJSON(res, {
                    clean: !hasInappropriateContent 
                });
                }

                // Restart/reset the server through PM2 after pulling the latest code.
                case "/restart":
                case "/reset": {
                    if (user.tech !== true) {
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

                        // Send the response before PM2 restarts this process.
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


        // ================================
        // UNKNOWN HTTP METHOD
        // ================================

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


    // Only accept Bearer tokens
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