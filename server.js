require("dotenv").config();
const http = require("http");
const ngrok = require("@ngrok/ngrok");

const PORT = 8085;

// HTTP Server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    console.log(`${req.method} ${url.pathname}`)

    switch (req.method) {

        case "GET":
            switch (url.pathname) {

                case "/":
                    return sendJSON(res, {
                        message: "API works, try another route"
                    })

                case "/hello":
                    return sendJSON(res, {
                        message: `Hello ${url.searchParams.get("name") ?? "World"}!`
                    })
                default:
                    return notFound(res)
            }

        case "POST":

            switch (url.pathname) {
                case "/echo":
                    let body = "";

                    req.on("data", chunk => body += chunk);

                    req.on("end", () => {
                        sendJSON(res, JSON.parse(body));
                    });

                    return;

                default:
                    return notFound(res);

            }
        default:
            return notFound(res);
    }

})


function sendJSON(res, data) {
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(data));
}

function notFound(res) {
    res.writeHead(404);
    res.end("Endpoint not found.");
}


server.listen(PORT, async () => {
    console.log(`Server listening on http://localhost:${PORT}`);

    const listener = await ngrok.forward({
        addr: PORT,
        authtoken_from_env: true,
    });

    console.log(`Tunnel: ${listener.url()}`);
});