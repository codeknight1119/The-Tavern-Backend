require("dotenv").config();
const admin = require("./services/firebase");
const http = require("http");
const ngrok = require("@ngrok/ngrok");

const PORT = 8085;

// HTTP Server
const server = http.createServer( async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(`${req.method} ${url.pathname}`);

    // 1. FIX: Handle CORS Preflight (OPTIONS) requests BEFORE authentication
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            // Tell the browser it is allowed to send your custom headers
            "Access-Control-Allow-Headers": "Content-Type, Authorization, ngrok-skip-browser-warning",
            "Access-Control-Max-Age": "86400" // Cache this response for 24 hours
        });
        return res.end();
    }

    // Authenticate actual GET/POST data requests
    const user = await authenticate(req);

    if(!user){
        return unauthorized(res);
    }

    switch (req.method) {
        case "GET":
            switch (url.pathname) {
                case "/":
                    return sendJSON(res, {
                        message: "API works, try another route"
                    });

                case "/hello":
                    return sendJSON(res, {
                        message: `Hello ${url.searchParams.get("name") ?? "World"}!`
                    });
                default:
                    return notFound(res);
            }

        case "POST":
            switch (url.pathname) {
                case "/echo": { 
                    let body = "";
                    req.setEncoding("utf8");

                    req.on("data", chunk => {
                        if (body.length + chunk.length > 1e6) { 
                            res.writeHead(413, { 
                                "Content-Type": "application/json",
                                "Access-Control-Allow-Origin": "*"
                            });
                            return res.end(JSON.stringify({ error: "Payload too large" }));
                        }
                        body += chunk;
                    });

                    req.on("end", () => {
                        try {
                            const parsedData = body ? JSON.parse(body) : {}; 
                            sendJSON(res, parsedData);
                        } catch (err) {
                            res.writeHead(400, { 
                                "Content-Type": "application/json",
                                "Access-Control-Allow-Origin": "*"
                            });
                            res.end(JSON.stringify({ error: "Invalid JSON payload" }));
                        }
                    });

                    return;
                }
                default:
                    return notFound(res);
            }
        default:
            return notFound(res);
    }
});

function sendJSON(res, data) {
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" // Allows standard requests
    });
    res.end(JSON.stringify(data));
}

// 2. FIX: Added the missing unauthorized helper function with CORS headers
function unauthorized(res) {
    res.writeHead(401, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
    });
    res.end(JSON.stringify({ error: "Unauthorized access" }));
}

// 3. FIX: Added CORS headers to the 404 handler just in case
function notFound(res) {
    res.writeHead(404, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ error: "Endpoint not found." }));
}

async function authenticate(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader)
        return null;

    const token = authHeader.replace("Bearer ", "");

    try {
        return await admin.auth().verifyIdToken(token);
    }
    catch {
        return null;
    }
}

server.listen(PORT, async () => {
    console.log(`Server listening on http://localhost:${PORT}`);

    try {
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken_from_env: true,
        });
        console.log(`Tunnel: ${listener.url()}`);
    } catch (error) {
        console.error("❌ Ngrok failed to initialize. Make sure NGROK_AUTHTOKEN is active in your .env file.");
        console.error(`Reason: ${error.message}`);
    }
});