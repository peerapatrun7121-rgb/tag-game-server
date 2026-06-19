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

// ลูปหลักของเซิร์ฟเวอร์ คำนวณเวลาทุกๆ 1 วินาที
function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    
    gameInterval = setInterval(() => {
        let activePlayers = Object.values(players).filter(p => !p.isSpectator);

        // จัดการเรื่องคูลดาวน์การแปะตัว
        Object.keys(players).forEach(id => {
            if (players[id].cooldown > 0) {
                players[id].cooldown--;
                io.emit('player_updated', players[id]);
            }
        });

        // 1. สถานะรอผู้เล่น (น้อยกว่า 2 คน)
        if (gameState.status === "waiting") {
            if (activePlayers.length >= 2) {
                gameState.status = "countdown";
                gameState.timer = 10;
                broadcastState();
            }
        }
        // 2. สถานะนับถอยหลังเริ่มเกม (10 วิ)
        else if (gameState.status === "countdown") {
            if (activePlayers.length < 2) {
                gameState.status = "waiting";
                gameState.timer = 0;
                broadcastState();
                return;
            }
            gameState.timer--;
            if (gameState.timer <= 0) {
                // เริ่มเกม: สุ่มคนเป็นระเบิดคนแรก
                gameState.status = "playing";
                const randomIndex = Math.floor(Math.random() * activePlayers.length);
                const luckyPlayer = activePlayers[randomIndex];
                
                gameState.bombOwnerId = luckyPlayer.id;
                luckyPlayer.isIt = true;
                luckyPlayer.bombTimer = 10;
                
                broadcastPlayers();
            }
            broadcastState();
        }
        // 3. สถานะกำลังแข่งขัน
        else if (gameState.status === "playing") {
            if (activePlayers.length <= 1) {
                // เหลือรอดคนเดียว = ชนะ
                if (activePlayers.length === 1) {
                    io.emit('game_over_winner', activePlayers[0].name);
                }
                resetGameToWaiting();
                return;
            }

            // หักเวลาระเบิดของคนที่ถืออยู่
            let owner = players[gameState.bombOwnerId];
            if (owner && owner.isIt) {
                owner.bombTimer--;
                io.emit('player_updated', owner);

                if (owner.bombTimer <= 0) {
                    // ตู้ม! คนถือระเบิดตาย
                    let explodedId = gameState.bombOwnerId;
                    io.to(explodedId).emit('you_exploded');
                    
                    // ปรับให้เป็นคนดูทันที
                    players[explodedId].isSpectator = true;
                    players[explodedId].isIt = false;
                    
                    // หาคนรับเคราะห์คนถัดไปที่ยังไม่ตาย
                    let remaining = Object.values(players).filter(p => !p.isSpectator);
                    if (remaining.length > 1) {
                        const nextIndex = Math.floor(Math.random() * remaining.length);
                        gameState.bombOwnerId = remaining[nextIndex].id;
                        players[gameState.bombOwnerId].isIt = true;
                        players[gameState.bombOwnerId].bombTimer = 10;
                        players[gameState.bombOwnerId].cooldown = 2; // กันแปะคืนทันที 2 วิ
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
    
    // รีเซ็ตให้ทุกคนฟื้นกลับมาเล่นรอบใหม่ได้
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
        // เงื่อนไข: ถ้าเกมเริ่มไปแล้ว คนเข้าใหม่จะกลายเป็น [คนดู] ทันที
        const shouldBeSpectator = (gameState.status === "playing" || gameState.status === "countdown");

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

    socket.on('player_move', (movementData) => {
        if (players[socket.id] && !players[socket.id].isSpectator) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].vx = movementData.vx;
            players[socket.id].vy = movementData.vy;
            socket.broadcast.emit('player_updated', players[socket.id]);
        }
    });

    socket.on('tag_player', (data) => {
        let itPlayer = players[data.itId];
        let taggedPlayer = players[data.taggedId];

        // เช็คเงื่อนไขความถูกต้องก่อนยอมให้แปะส่งระเบิด
        if (itPlayer && taggedPlayer && itPlayer.isIt && !taggedPlayer.isSpectator && itPlayer.cooldown === 0 && taggedPlayer.cooldown === 0) {
            itPlayer.isIt = false;
            itPlayer.cooldown = 2; // ติดคูลดาวน์คนส่ง 2 วินาที (ห้ามแปะคืนทันที)

            taggedPlayer.isIt = true;
            taggedPlayer.bombTimer = 10; // รีเซ็ตเวลาระเบิดใหม่เป็น 10 วิ
            taggedPlayer.cooldown = 2;   // คนรับก็ติดคูลดาวน์ 2 วินาทีเช่นกัน

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
            // ถ้าคนถือระเบิดกดออกจากเกม ให้สุ่มคนใหม่ทันที
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
