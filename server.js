require("dotenv").config();
const http = require("http");
const ngrok = require("@ngrok/ngrok");

const PORT = 8085;

// HTTP Server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(`${req.method} ${url.pathname}`);

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
                // Enclosing the case in braces {} creates a safe block-scope
                case "/echo": { 
                    let body = "";
                    req.setEncoding("utf8"); // Safely interpret chunks as string data

                    req.on("data", chunk => {
                        // Protect against memory exhaustion (Limit payload to ~1MB)
                        if (body.length + chunk.length > 1e6) { 
                            res.writeHead(413, { "Content-Type": "application/json" });
                            return res.end(JSON.stringify({ error: "Payload too large" }));
                        }
                        body += chunk;
                    });

                    req.on("end", () => {
                        try {
                            // Guard against completely empty bodies
                            const parsedData = body ? JSON.parse(body) : {}; 
                            sendJSON(res, parsedData);
                        } catch (err) {
                            // Gracefully catch invalid JSON without crashing the server
                            res.writeHead(400, { "Content-Type": "application/json" });
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
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(data));
}

function notFound(res) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Endpoint not found.");
}

server.listen(PORT, async () => {
    console.log(`Server listening on http://localhost:${PORT}`);

    // Wrap ngrok initialization in a try/catch block 
    // to catch missing or invalid token configuration errors.
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