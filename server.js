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

const SKILL_SETTINGS = {
    mage: {
        1: { name: "บอลเพลิงเส้นตรง", speed: 6, radius: 10, type: "fire" },
        2: { name: "อุกกาบาตตกจากฟ้า", speed: 0, radius: 45, type: "fire" }
    },
    ninja: {
        1: { name: "ดาวสายฟ้าเส้นตรง", speed: 7, radius: 8, type: "lightning" },
        2: { name: "สายฟ้าฟาดจากสวรรค์", speed: 0, radius: 45, type: "lightning" }
    }
};

const walls = [
    { x: 200, y: 150, w: 40, h: 200 },
    { x: 560, y: 150, w: 40, h: 200 },
    { x: 350, y: 230, w: 100, h: 40 }
];

setInterval(() => {
    for (let i = serverProjectiles.length - 1; i >= 0; i--) {
        let proj = serverProjectiles[i];
        if (proj.skillNum === 1) {
            proj.x += proj.vx; proj.y += proj.vy;
        } else {
            if(!proj.expireTime) proj.expireTime = Date.now() + 400;
            if(Date.now() > proj.expireTime) { serverProjectiles.splice(i, 1); continue; }
        }

        Object.keys(players).forEach(pId => {
            let p = players[pId];
            if (pId !== proj.ownerId && !p.isSpectator && p.health > 0) {
                let dist = Math.hypot(proj.x - p.x, proj.y - (p.y - 15));
                if (dist < (proj.r + 14)) {
                    if(proj.skillNum === 2) {
                        if(!proj.hitPlayers) proj.hitPlayers = [];
                        if(proj.hitPlayers.includes(pId)) return;
                        proj.hitPlayers.push(pId);
                    }
                    p.health--;
                    io.emit('player_updated', p);
                    if (p.health <= 0) { p.isSpectator = true; io.to(pId).emit('game_over_died'); }
                    if(proj.skillNum === 1) serverProjectiles.splice(i, 1);
                }
            }
        });

        if (proj.skillNum === 1 && serverProjectiles[i] && (proj.x < 0 || proj.x > 800 || proj.y < 0 || proj.y > 450)) {
            serverProjectiles.splice(i, 1);
        }
    }
}, 1000 / 60);

function checkWallCollision(x, y, radius) {
    for (let wall of walls) {
        if (x + radius > wall.x && x - radius < wall.x + wall.w && y + radius > wall.y && y - radius < wall.y + wall.h) {
            return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        players[socket.id] = {
            id: socket.id, x: Math.random() * 400 + 200, y: Math.random() * 200 + 150,
            name: data.name, color: data.color || '#ffffff', hat: data.hat || 'none',
            charClass: data.charClass || 'mage', health: 3, vx: 0, vy: 0, isSpectator: false,
            facingX: 1, facingY: 0
        };
        socket.emit('current_players', players);
        socket.broadcast.emit('new_player', players[socket.id]);
    });

    socket.on('player_move_direct', (coords) => {
        let me = players[socket.id];
        if (me && !me.isSpectator && me.health > 0) {
            me.x = coords.x; me.y = coords.y; me.vx = coords.vx; me.vy = coords.vy;
            me.facingX = coords.facingX; me.facingY = coords.facingY;
            socket.broadcast.emit('player_updated', me);
        }
    });

    socket.on('player_dash', (dir) => {
        let me = players[socket.id];
        if (!me || me.isSpectator || me.health <= 0) return;

        let targetDashDistance = 75;
        let stepX = dir.dirX * targetDashDistance;
        let stepY = dir.dirY * targetDashDistance;

        let nextX = Math.max(12, Math.min(800 - 12, me.x + stepX));
        let nextY = Math.max(52, Math.min(450 - 12, me.y + stepY));

        if (!checkWallCollision(nextX, nextY, 12)) {
            me.x = nextX; me.y = nextY;
        }
        io.emit('player_updated', me);
    });

    socket.on('cast_skill', (data) => {
        let me = players[socket.id];
        if (!me || me.isSpectator || me.health <= 0) return;

        let settings = SKILL_SETTINGS[me.charClass]?.[data.skillNum];
        if (!settings) return;

        io.emit('skill_telegraph', { ownerId: socket.id, skillNum: data.skillNum, type: settings.type });

        setTimeout(() => {
            let currentMe = players[socket.id];
            if (currentMe && !currentMe.isSpectator && currentMe.health > 0) {
                let finalDirX = currentMe.facingX !== undefined ? currentMe.facingX : 1;
                let finalDirY = currentMe.facingY !== undefined ? currentMe.facingY : 0;

                let spawnX = data.skillNum === 1 ? currentMe.x : currentMe.x + finalDirX * 90;
                let spawnY = data.skillNum === 1 ? currentMe.y - 15 : (currentMe.y - 15) + finalDirY * 90;

                let projData = {
                    x: spawnX, y: spawnY,
                    vx: data.skillNum === 1 ? finalDirX * settings.speed : 0,
                    vy: data.skillNum === 1 ? finalDirY * settings.speed : 0,
                    r: settings.radius, type: settings.type, skillNum: data.skillNum, ownerId: socket.id
                };
                serverProjectiles.push(projData);
                io.emit('skill_projectile', projData);
            }
        }, 1000);
    });

    socket.on('disconnect', () => { delete players[socket.id]; io.emit('player_disconnected', socket.id); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Battle Server running on port ${PORT}`); });
