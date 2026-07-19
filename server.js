const http = require('http');
// 1. Import the ngrok package
const ngrok = require('@ngrok/ngrok');

const PORT = 3000;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: "Hello from your Node.js server!" }));
    } 
    else if (req.url === '/' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                message: "Data received successfully!", 
                receivedData: body 
            }));
        });
    } 
    else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Route not found" }));
    }
});

server.listen(PORT, async () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
    
    // 2. Automatically establish the ngrok tunnel when the server starts
    try {
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken: process.env.NGROK_AUTHTOKEN // Pulls your token from the OS environment
        });
        console.log(`Ingress established at: ${listener.url()}`);
    } catch (error) {
        console.error("Error setting up ngrok:", error);
    }
});