require("dotenv").config();

const firebase = require("./services/firebase");
const http = require("http");
const ngrok = require("@ngrok/ngrok");

const PORT = 8085;


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


                default:
                    return notFound(res);
            }
        }


        // ================================
        // POST
        // ================================

        if (req.method === "POST") {

            switch (url.pathname) {

                case "/setRole": {

                    // Make sure the authenticated user
                    // is an officer.
                    if (user.officer !== true) {
                        return sendJSON(
                            res,
                            {
                                error: "Unauthorized"
                            },
                            403
                        );
                    }


                    // Read the POST body
                    const body = await readBody(req);

                    console.log("POST body:", body);


                    return sendJSON(res, {
                        message: "Welcome, officer",
                        received: body
                    });
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