const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let players = {};
let serverProjectiles = [];

// วงความกว้างสกิลพอดีตัว (ไม่ทำวงกว้างเกินไปตามสั่ง)
const SKILL_SETTINGS = {
    mage: {
        1: { name: "บอลเพลิง", speed: 6, radius: 10, type: "fire" },
        2: { name: "เปลวพุ่ง", speed: 8, radius: 7, type: "fire" }
    },
    ninja: {
        1: { name: "ดาวสายฟ้า", speed: 7, radius: 8, type: "lightning" },
        2: { name: "กระสุนจักระ", speed: 9, radius: 6, type: "lightning" }
    }
};

setInterval(() => {
    // ลูปหลักฝั่งเซิร์ฟเวอร์ คำนวณพิกัดกระสุนสกิลชนคนเล่นเพื่อหักหัวใจ
    for (let i = serverProjectiles.length - 1; i >= 0; i--) {
        let proj = serverProjectiles[i];
        proj.x += proj.vx;
        proj.y += proj.vy;

        // ตรวจเช็คกระสุนชนผู้เล่นคนอื่นไหม
        Object.keys(players).forEach(pId => {
            let p = players[pId];
            if (pId !== proj.ownerId && !p.isSpectator && p.health > 0) {
                let dist = Math.hypot(proj.x - p.x, proj.y - (p.y - 15)); // ชนกลางลำตัว
                if (dist < (proj.r + 14)) {
                    // ชนเป้าหมาย!! ลดเลือด 1 หัวใจ
                    p.health--;
                    io.emit('player_updated', p);

                    // หากหัวใจหมด 3 ดวง ตกรอบ
                    if (p.health <= 0) {
                        p.isSpectator = true;
                        io.to(pId).emit('game_over_died');
                    }
                    // ลบกระสุนนี้ออกทันทีเมื่อทำงานเสร็จ
                    serverProjectiles.splice(i, 1);
                }
            }
        });

        // ลบกระสุนที่หลุดหน้าจอเซิร์ฟเวอร์
        if (serverProjectiles[i] && (proj.x < 0 || proj.x > 800 || proj.y < 0 || proj.y > 450)) {
            serverProjectiles.splice(i, 1);
        }
    }
}, 1000 / 60); // รัน 60 เฟรมต่อวิ

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        // ลงทะเบียนผู้เล่นพร้อม 3 หัวใจเต็มสัดส่วน ❤️❤️❤️
        players[socket.id] = {
            id: socket.id, x: Math.random() * 400 + 200, y: Math.random() * 200 + 150,
            name: data.name, color: data.color || '#ffffff', hat: data.hat || 'none',
            charClass: data.charClass || 'mage', health: 3, vx: 0, vy: 0, isSpectator: false
        };
        socket.emit('current_players', players);
        socket.broadcast.emit('new_player', players[socket.id]);
    });

    socket.on('player_move_direct', (coords) => {
        let me = players[socket.id];
        if (me && !me.isSpectator && me.health > 0) {
            me.x = coords.x; me.y = coords.y; me.vx = coords.vx; me.vy = coords.vy;
            socket.broadcast.emit('player_updated', me);
        }
    });

    // 🟥 ระบบร่ายสกิล: ส่งสัญญาณเส้นเล็งล่วงหน้า 1 วินาที ก่อนส่งพลังงานออกไป
    socket.on('cast_skill', (data) => {
        let me = players[socket.id];
        if (!me || me.isSpectator || me.health <= 0) return;

        let settings = SKILL_SETTINGS[me.charClass]?.[data.skillNum];
        if (!settings) return;

        // สั่งให้ทุกเครื่องขึ้นเส้นเตือนประสีแดงเล็งทิศทางนั้นทันที
        io.emit('skill_telegraph', {
            x: me.x, y: me.y - 15,
            dx: data.dirX, dy: data.dirY,
            type: settings.type
        });

        // หน่วงเวลาเซิร์ฟเวอร์ไว้ 1 วินาที (1000ms) แล้วค่อยปล่อยสกิลของจริงพุ่งออกมา 🌟
        setTimeout(() => {
            // เช็คอีกครั้งว่าคนร่ายยังไม่ตายตอนเวลาผ่านไป 1 วิ
            if (players[socket.id] && !players[socket.id].isSpectator) {
                let currentMe = players[socket.id];
                let projData = {
                    x: currentMe.x,
                    y: currentMe.y - 15,
                    vx: data.dirX * settings.speed,
                    vy: data.dirY * settings.speed,
                    r: settings.radius,
                    type: settings.type,
                    ownerId: socket.id
                };
                serverProjectiles.push(projData);
                io.emit('skill_projectile', projData); // ส่งให้หน้าจอลูกค้าวาดผลเอฟเฟกต์พุ่ง
            }
        }, 1000);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('player_disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Battle Server running on port ${PORT}`); });
