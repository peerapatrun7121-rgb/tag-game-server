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
    status: "waiting", // waiting, countdown, playing
    timer: 0,
    bombOwnerId: null
};

let gameInterval = null;

function broadcastState() {
    io.emit('game_state_update', gameState);
}

function broadcastPlayers() {
    io.emit('current_players', players);
}

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
            // ถ้าในระหว่างนับถอยหลัง มีคนกดออกจนผู้เล่นเหลือน้อยกว่า 2 คน ให้กลับไปรอใหม่
            if (activePlayers.length < 2) {
                gameState.status = "waiting";
                gameState.timer = 0;
                broadcastState();
                return;
            }
            gameState.timer--;
            if (gameState.timer <= 0) {
                gameState.status = "playing";
                
                // ดึงรายชื่อคนทั้งหมดที่อยู่ในห้อง ณ วินาทีนั้น (รวมคนที่กดเข้ามาระหว่างนับถอยหลัง 10 วิด้วย) มาสุ่มระเบิด
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
    gameState.status = "waiting";
    gameState.timer = 0;
    gameState.bombOwnerId = null;
    
    Object.keys(players).forEach(id => {
        players[id].isSpectator = false;
        players[id].isIt = false;
        players[id].bombTimer = 10;
        players[id].cooldown = 0;
    });
    broadcastPlayers();
    broadcastState();
}

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        // ✨ แก้ไขจุดนี้: จะให้เป็นผู้ชมก็ต่อเมื่อรอบการแข่ง "เริ่มวิ่งไล่จับไปแล้ว" (playing) เท่านั้น
        // หากอยู่ในช่วงนับถอยหลังก่อน 10 วินาที (countdown) จะได้สิทธิ์เป็นผู้เล่นเตรียมตัววิ่งปกติทันที!
        const shouldBeSpectator = (gameState.status === "playing");

        players[socket.id] = {
            id: socket.id,
            x: Math.random() * 400 + 200,
            y: Math.random() * 200 + 150,
            name: data.name,
            isIt: false,
            vx: 0,
            vy: 0,
            bombTimer: 10,
            cooldown: 0,
            isSpectator: shouldBeSpectator
        };

        socket.emit('current_players', players);
        socket.broadcast.emit('new_player', players[socket.id]);
        socket.emit('game_state_update', gameState);

        if (!gameInterval) startGameLoop();
    });

    socket.on('player_move', (inputData) => {
        let me = players[socket.id];
        if (me && !me.isSpectator) {
            let baseSpeed = 3.5; 
            let vx = 0;
            let vy = 0;

            if (inputData.up) vy = -baseSpeed;
            if (inputData.down) vy = baseSpeed;
            if (inputData.left) vx = -baseSpeed;
            if (inputData.right) vx = baseSpeed;

            if (vx !== 0 && vy !== 0) {
                vx *= 0.7071;
                vy *= 0.7071;
            }

            const walls = [
                { x: 200, y: 150, w: 40, h: 200 },
                { x: 560, y: 150, w: 40, h: 200 },
                { x: 350, y: 230, w: 100, h: 40 }
            ];

            me.vx = vx;
            me.vy = vy;
            
            me.x += me.vx;
            for (let wall of walls) {
                if (me.x + 12 > wall.x && me.x - 12 < wall.x + wall.w && me.y + 12 > wall.y && me.y - 12 < wall.y + wall.h) {
                    if (me.vx > 0) me.x = wall.x - 12;
                    if (me.vx < 0) me.x = wall.x + wall.w + 12;
                }
            }
            me.x = Math.max(12, Math.min(800 - 12, me.x));

            me.y += me.vy;
            for (let wall of walls) {
                if (me.x + 12 > wall.x && me.x - 12 < wall.x + wall.w && me.y + 12 > wall.y && me.y - 12 < wall.y + wall.h) {
                    if (me.vy > 0) me.y = wall.y - 12;
                    if (me.vy < 0) me.y = wall.y + wall.h + 12;
                }
            }
            me.y = Math.max(12 + 40, Math.min(450 - 12, me.y));

            io.emit('player_updated', me);
        }
    });

    socket.on('tag_player', (data) => {
        let itPlayer = players[data.itId];
        let taggedPlayer = players[data.taggedId];

        if (itPlayer && taggedPlayer && itPlayer.isIt && !taggedPlayer.isSpectator && itPlayer.cooldown === 0 && taggedPlayer.cooldown === 0) {
            itPlayer.isIt = false;
            itPlayer.cooldown = 2;

            taggedPlayer.isIt = true;
            taggedPlayer.bombTimer = 10;
            taggedPlayer.cooldown = 2;

            gameState.bombOwnerId = taggedPlayer.id;

            io.emit('player_updated', itPlayer);
            io.emit('player_updated', taggedPlayer);
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
                players[gameState.bombOwnerId].isIt = true;
                players[gameState.bombOwnerId].bombTimer = 10;
                broadcastPlayers();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
