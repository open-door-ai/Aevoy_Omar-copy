"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ws_1 = require("ws");
var http_1 = require("http");
var express_1 = require("express");
var app = (0, express_1.default)();
var server = (0, http_1.createServer)(app);
var wss = new ws_1.WebSocketServer({ server: server });
var PORT = process.env.VISION_PORT || 3004;
var latestFrame = null;
var presenceState = false;
var frameCount = 0;
var clientCount = 0;
// Health check
app.get('/health', function (req, res) {
    res.json({
        status: 'ok',
        service: 'vision',
        port: PORT,
        clients: clientCount,
        frames: frameCount,
        presence: presenceState
    });
});
// WebSocket connection for camera feed
wss.on('connection', function (ws) {
    clientCount++;
    console.log("[CAMERA-SERVICE] \u2705 Client connected (total: ".concat(clientCount, ")"));
    // Send presence state immediately
    ws.send(JSON.stringify({ type: 'presence', present: presenceState }));
    // Send latest frame if available
    if (latestFrame) {
        ws.send(JSON.stringify({
            type: 'frame',
            imageUrl: "data:image/jpeg;base64,".concat(latestFrame.toString('base64')),
            timestamp: Date.now()
        }));
    }
    ws.on('close', function () {
        clientCount--;
        console.log("[CAMERA-SERVICE] \u274C Client disconnected (total: ".concat(clientCount, ")"));
    });
    ws.on('error', function (error) {
        console.error('[CAMERA-SERVICE] WebSocket error:', error.message);
    });
});
// HTTP endpoint to receive frames from Python detector
app.post('/frame', express_1.default.raw({ type: 'image/jpeg', limit: '5mb' }), function (req, res) {
    latestFrame = req.body;
    frameCount++;
    // Broadcast to all connected clients
    var broadcastCount = 0;
    wss.clients.forEach(function (client) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            try {
                client.send(JSON.stringify({
                    type: 'frame',
                    imageUrl: "data:image/jpeg;base64,".concat(latestFrame.toString('base64')),
                    timestamp: Date.now(),
                    frameCount: frameCount
                }));
                broadcastCount++;
            }
            catch (error) {
                console.error('[CAMERA-SERVICE] Failed to send frame:', error);
            }
        }
    });
    // Log every 100 frames
    if (frameCount % 100 === 0) {
        console.log("[CAMERA-SERVICE] \uD83D\uDCF8 Frame ".concat(frameCount, " broadcasted to ").concat(broadcastCount, " clients"));
    }
    res.sendStatus(200);
});
// HTTP endpoint to update presence state
app.post('/presence', express_1.default.json(), function (req, res) {
    var present = req.body.present;
    if (typeof present !== 'boolean') {
        return res.status(400).json({ error: 'Invalid presence value' });
    }
    var changed = presenceState !== present;
    presenceState = present;
    if (changed) {
        // Broadcast to Mission Control
        var broadcastCount_1 = 0;
        wss.clients.forEach(function (client) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify({
                        type: 'presence',
                        present: present,
                        timestamp: Date.now()
                    }));
                    broadcastCount_1++;
                }
                catch (error) {
                    console.error('[CAMERA-SERVICE] Failed to send presence:', error);
                }
            }
        });
        var icon = present ? '✅' : '❌';
        console.log("[CAMERA-SERVICE] ".concat(icon, " Presence: ").concat(present ? 'DETECTED' : 'LOST', " \u2192 broadcasted to ").concat(broadcastCount_1, " clients"));
    }
    res.sendStatus(200);
});
// Graceful shutdown
process.on('SIGINT', function () {
    console.log('\n[CAMERA-SERVICE] 🛑 Shutting down...');
    wss.clients.forEach(function (client) {
        client.close(1000, 'Server shutting down');
    });
    server.close(function () {
        console.log('[CAMERA-SERVICE] 👋 Server closed');
        process.exit(0);
    });
});
server.listen(PORT, function () {
    console.log("[CAMERA-SERVICE] \uD83D\uDE80 WebSocket server running on port ".concat(PORT));
    console.log("[CAMERA-SERVICE] \uD83D\uDCE1 Endpoints:");
    console.log("  - GET  /health");
    console.log("  - POST /frame (image/jpeg)");
    console.log("  - POST /presence (JSON)");
    console.log("  - WS   ws://localhost:".concat(PORT));
});
