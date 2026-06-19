const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // อนุญาตให้เชื่อมต่อข้ามโดเมนจาก GitHub Pages ได้

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // ยอมรับการเชื่อมต่อจากทุกหน้าเว็บ
        methods: ["GET", "POST"]
    }
});

let players = {}; // เก็บข้อมูลผู้เล่นทุกคนที่ออนไลน์อยู่
let walls = [ // ตำแหน่งกำแพงที่ต้องตรงกันทุกคน
    { x: 200, y: 120, w: 40, h: 200 },
    { x: 560, y: 120, w: 40, h: 200 },
    { x: 350, y: 200, w: 100, h: 40 }
];

io.on('connection', (socket) => {
    console.log(`ผู้เล่นเชื่อมต่อแล้ว: ${socket.id}`);

    // 1. เมื่อผู้เล่นใหม่กดเริ่มเกมและส่งชื่อมา
    socket.on('join_game', (data) => {
        // ถ้าเป็นผู้เล่นคนแรกของเซิร์ฟเวอร์ ให้เป็นคนไล่จับ (สีแดง) ทันที
        const isFirstPlayer = Object.keys(players).length === 0;

        players[socket.id] = {
            id: socket.id,
            x: Math.random() * 500 + 100,
            y: Math.random() * 300 + 100,
            name: data.name,
            isIt: isFirstPlayer, // คนแรกเป็นสีแดง
            vx: 0,
            vy: 0,
            cooldown: 0
        };

        // ส่งข้อมูลผู้เล่นทั้งหมดที่มีอยู่ตอนนี้กลับไปให้ผู้เล่นใหม่
        socket.emit('current_players', players);
        // แจ้งทุกคนในเซิร์ฟเวอร์ว่ามีคนมาใหม่
        socket.broadcast.emit('new_player', players[socket.id]);
    });

    // 2. เมื่อผู้เล่นขยับตัว
    socket.on('player_move', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].vx = movementData.vx;
            players[socket.id].vy = movementData.vy;
            
            // ส่งข้อมูลการขยับนี้ไปให้คนอื่นๆ รู้
            socket.broadcast.emit('player_updated', players[socket.id]);
        }
    });

    // 3. ระบบเช็คคนไล่จับชนคนอื่น (ส่งต่อตำแหน่งคนเป็นสีแดง)
    socket.on('tag_player', (data) => {
        if (players[data.itId] && players[data.taggedId]) {
            players[data.itId].isIt = false;
            players[data.taggedId].isIt = true;
            // แจ้งทุกคนให้เปลี่ยนสีตัวละครตามนี้
            io.emit('roles_updated', { itId: data.itId, taggedId: data.taggedId });
        }
    });

    // 4. เมื่อผู้เล่นปิดหน้าเว็บหนีไป (Disconnect)
    socket.on('disconnect', () => {
        console.log(`ผู้เล่นออกจากเกม: ${socket.id}`);
        const wasIt = players[socket.id]?.isIt;
        delete players[socket.id];
        
        // บอกทุกคนให้ลบตัวละครนี้ออกผิวจอ
        io.emit('player_disconnected', socket.id);

        // ถ้าคนที่เป็นสีแดงออกไป ให้สุ่มคนใหม่ขึ้นมาเป็นสีแดงแทน
        if (wasIt && Object.keys(players).length > 0) {
            const playerIds = Object.keys(players);
            const randomId = playerIds[Math.floor(Math.random() * playerIds.length)];
            players[randomId].isIt = true;
            io.emit('new_it_assigned', randomId);
        }
    });
});

// ตั้งค่า Port ของ Server สำหรับเปิดออนไลน์
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์เกมรันอยู่ที่ Port: ${PORT}`);
});