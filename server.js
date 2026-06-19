const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let players = {};
let gameState = {
    status: "waiting",
    timer: 0,
    bombOwnerId: null
};

let gameInterval = null;

function broadcastState() { io.emit('game_state_update', gameState); }
function broadcastPlayers() { io.emit('current_players', players); }

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    
    gameInterval = setInterval(() => {
        let activePlayers = Object.values(players).filter(p => !p.isSpectator);

        Object.keys(players).forEach(id => {
            if (players[id].cooldown > 0) {
                players[id].cooldown--;
                io.emit('player_updated', players[id]);
            }
        });

        if (gameState.status === "waiting") {
            if (activePlayers.length >= 2) {
                gameState.status = "countdown";
                gameState.timer = 10;
                broadcastState();
            }
        }
        else if (gameState.status === "countdown") {
            if (activePlayers.length < 2) {
                gameState.status = "waiting";
                gameState.timer = 0;
                broadcastState();
                return;
            }
            gameState.timer--;
            if (gameState.timer <= 0) {
                gameState.status = "playing";
                let finalActivePlayers = Object.values(players).filter(p => !p.isSpectator);
                if (finalActivePlayers.length >= 2) {
                    const randomIndex = Math.floor(Math.random() * finalActivePlayers.length);
                    const luckyPlayer = finalActivePlayers[randomIndex];
                    gameState.bombOwnerId = luckyPlayer.id;
                    luckyPlayer.isIt = true;
                    luckyPlayer.bombTimer = 10;
                }
                broadcastPlayers();
            }
            broadcastState();
        }
        else if (gameState.status === "playing") {
            if (activePlayers.length <= 1) {
                if (activePlayers.length === 1) {
                    io.emit('game_over_winner', activePlayers[0].name);
                }
                resetGameToWaiting();
                return;
            }

            let owner = players[gameState.bombOwnerId];
            if (owner && owner.isIt) {
                owner.bombTimer--;
                io.emit('player_updated', owner);

                if (owner.bombTimer <= 0) {
                    let explodedId = gameState.bombOwnerId;
                    io.to(explodedId).emit('you_exploded');
                    
                    players[explodedId].isSpectator = true;
                    players[explodedId].isIt = false;
                    
                    let remaining = Object.values(players).filter(p => !p.isSpectator);
                    if (remaining.length > 1) {
                        const nextIndex = Math.floor(Math.random() * remaining.length);
                        gameState.bombOwnerId = remaining[nextIndex].id;
                        players[gameState.bombOwnerId].isIt = true;
                        players[gameState.bombOwnerId].bombTimer = 10;
                        players[gameState.bombOwnerId].cooldown = 2;
                    }
                    broadcastPlayers();
                }
            }
        }
    }, 1000);
}

function resetGameToWaiting() {
    gameState.status = "waiting"; gameState.timer = 0; gameState.bombOwnerId = null;
    Object.keys(players).forEach(id => {
        players[id].isSpectator = false; players[id].isIt = false; players[id].bombTimer = 10; players[id].cooldown = 0;
    });
    broadcastPlayers(); broadcastState();
}

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        const shouldBeSpectator = (gameState.status === "playing");
        players[socket.id] = {
            id: socket.id,
            x: Math.random() * 400 + 200, y: Math.random() * 200 + 150,
            name: data.name, isIt: false, vx: 0, vy: 0, bombTimer: 10, cooldown: 0, isSpectator: shouldBeSpectator
        };
        socket.emit('current_players', players);
        socket.broadcast.emit('new_player', players[socket.id]);
        socket.emit('game_state_update', gameState);
        if (!gameInterval) startGameLoop();
    });

    // ✨ แก้ไขจุดบั๊ก: รับค่า x, y ตรงๆ และกระจายออกไปหาผู้เล่นทุกคนในห้องทันที
    socket.on('player_move_direct', (coords) => {
        if (players[socket.id] && !players[socket.id].isSpectator) {
            players[socket.id].x = coords.x;
            players[socket.id].y = coords.y;
            players[socket.id].vx = coords.vx;
            players[socket.id].vy = coords.vy;
            
            // ส่งอัปเดตกระจายออกไปให้ผู้เล่นคนอื่นเห็นตำแหน่งแบบ Real-time
            io.emit('player_updated', players[socket.id]);
        }
    });

    socket.on('tag_player', (data) => {
        let itPlayer = players[data.itId];
        let taggedPlayer = players[data.taggedId];
        if (itPlayer && taggedPlayer && itPlayer.isIt && !taggedPlayer.isSpectator && itPlayer.cooldown === 0 && taggedPlayer.cooldown === 0) {
            itPlayer.isIt = false; itPlayer.cooldown = 2;
            taggedPlayer.isIt = true; taggedPlayer.bombTimer = 10; taggedPlayer.cooldown = 2;
            gameState.bombOwnerId = taggedPlayer.id;
            io.emit('player_updated', itPlayer); io.emit('player_updated', taggedPlayer);
        }
    });

    socket.on('disconnect', () => {
        const wasIt = players[socket.id]?.isIt;
        delete players[socket.id];
        io.emit('player_disconnected', socket.id);
        if (Object.keys(players).length < 2) {
            resetGameToWaiting();
        } else if (wasIt && gameState.status === "playing") {
            let remaining = Object.values(players).filter(p => !p.isSpectator);
            if (remaining.length > 0) {
                const nextIndex = Math.floor(Math.random() * remaining.length);
                gameState.bombOwnerId = remaining[nextIndex].id;
                players[gameState.bombOwnerId].isIt = true; players[gameState.bombOwnerId].bombTimer = 10;
                broadcastPlayers();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
