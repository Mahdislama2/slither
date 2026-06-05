const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

const WORLD_RADIUS = 2500;
let players = {};
let foods = [];

function getNextShortId() {
    let usedIds = new Set(Object.values(players).map(p => p.shortId));
    let id = 1;
    while (usedIds.has(id)) {
        id++;
    }
    return id;
}

for (let i = 0; i < 600; i++) {
    let angle = Math.random() * Math.PI * 2;
    let dist = Math.random() * WORLD_RADIUS;
    foods.push({
        id: Math.random().toString(36).substring(2, 9),
        x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
        color: ['#ff0055', '#00d4ff', '#00ff66', '#9900ff', '#ffcc00'][Math.floor(Math.random() * 5)],
        radius: Math.random() * 3 + 3, isGlowing: Math.random() < 0.2
    });
}

function getSafeSpawn() {
    let safeX = 0, safeY = 0, isSafe = false;
    let attempts = 0;
    while (!isSafe && attempts < 100) {
        attempts++;
        let angle = Math.random() * Math.PI * 2;
        let dist = Math.random() * (WORLD_RADIUS - 300);
        safeX = Math.cos(angle) * dist; safeY = Math.sin(angle) * dist;
        isSafe = true;
        for (let id in players) {
            if (Math.hypot(safeX - players[id].x, safeY - players[id].y) < 400) { isSafe = false; break; }
        }
    }
    return { x: safeX, y: safeY };
}

let lastUpdateTimes = {};

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        let name = (data.name || "").trim();
        // Remove HTML tags to prevent XSS
        name = name.replace(/<[^>]*>/g, "");
        
        if (name.length === 0) {
            socket.emit('join_error', { message: 'Please enter a name to play!' });
            return;
        }
        if (name.length > 15) {
            name = name.substring(0, 15);
        }

        // Enforce unique names among active players
        let nameExists = Object.values(players).some(p => p.name.toLowerCase() === name.toLowerCase());
        if (nameExists) {
            socket.emit('join_error', { message: 'Name already taken, please choose another!' });
            return;
        }

        let spawnPos = getSafeSpawn();
        let colorSeq = data.colors;
        if (!colorSeq || !Array.isArray(colorSeq) || colorSeq.length === 0) {
            colorSeq = [['#ff0055'], ['#00d4ff'], ['#00ff66'], ['#9900ff']][Math.floor(Math.random() * 4)];
        }
        let shortId = getNextShortId();
        players[socket.id] = {
            id: socket.id, shortId: shortId, name: name, x: spawnPos.x, y: spawnPos.y,
            angle: 0, targetAngle: 0, length: 20, radius: 16,
            body: Array(60).fill({ x: spawnPos.x, y: spawnPos.y }),
            isBoosting: false, skinUrl: data.skinUrl || "",
            colors: colorSeq,
            color: colorSeq[0]
        };
        socket.emit('game_init', { id: socket.id, x: spawnPos.x, y: spawnPos.y });
    });

    socket.on('player_update', (data) => {
        let now = Date.now();
        let lastTime = lastUpdateTimes[socket.id] || 0;
        // Rate limit updates to prevent flooding (max ~80 updates per second)
        if (now - lastTime < 12) {
            return; 
        }
        lastUpdateTimes[socket.id] = now;

        let p = players[socket.id];
        if (p) { 
            // Validate data ranges to prevent overflow/NaN tampering
            let angle = parseFloat(data.angle);
            if (!isNaN(angle)) {
                p.targetAngle = angle;
            }
            p.isBoosting = !!data.isBoosting; 
        }
    });

    socket.on('disconnect', () => { 
        delete players[socket.id]; 
        delete lastUpdateTimes[socket.id];
    });
});

setInterval(() => {
    for (let id in players) {
        let p = players[id];
        let speed = p.isBoosting && p.length > 15 ? 6.5 : 3.5;
        p.radius = 16 + (p.length * 0.08);

        let maxTurnSpeed = 0.08 - (p.length * 0.0002); 
        maxTurnSpeed = Math.max(0.03, maxTurnSpeed); 

        let angleDiff = p.targetAngle - p.angle;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

        if (Math.abs(angleDiff) > maxTurnSpeed) {
            p.angle += Math.sign(angleDiff) * maxTurnSpeed;
        } else {
            p.angle = p.targetAngle;
        }

        if (p.isBoosting && p.length > 15) {
            p.radius *= 0.95;
            if (Math.random() < 0.2) {
                p.length -= 0.15;
                let tail = p.body[p.body.length - 1];
                if (tail) {
                    foods.push({
                        id: Math.random().toString(36).substring(2, 9), 
                        x: tail.x + (Math.random()-0.5)*15, y: tail.y + (Math.random()-0.5)*15,
                        color: p.color, radius: 4, isGlowing: true
                    });
                }
            }
        }

        p.x += Math.cos(p.angle) * speed;
        p.y += Math.sin(p.angle) * speed;

        if (Math.hypot(p.x, p.y) > WORLD_RADIUS) { handlePlayerDeath(id); continue; }

        // السيرفر يضيف الرأس الجديد في أول المصفوفة
        p.body.unshift({ x: p.x, y: p.y });
        while (p.body.length > p.length * 3) p.body.pop();
    }

    // فحص التصادم
    for (let id1 in players) {
        let p1 = players[id1];
        for (let id2 in players) {
            if (id1 === id2) continue;
            let p2 = players[id2];
            for (let k = 3; k < p2.body.length; k += 3) {
                if (Math.hypot(p1.x - p2.body[k].x, p1.y - p2.body[k].y) < p1.radius + p2.radius - 2) {
                    handlePlayerDeath(id1); break;
                }
            }
        }
    }

    // فحص الأكل
    for (let i = foods.length - 1; i >= 0; i--) {
        let f = foods[i];
        for (let id in players) {
            let p = players[id];
            if (Math.hypot(p.x - f.x, p.y - f.y) < p.radius + 2) {
                p.length += f.radius * 0.08;
                if (f.radius < 6) {
                    let angle = Math.random() * Math.PI * 2;
                    let dist = Math.random() * WORLD_RADIUS;
                    f.x = Math.cos(angle) * dist; f.y = Math.sin(angle) * dist;
                    f.id = Math.random().toString(36).substring(2, 9);
                } else { foods.splice(i, 1); }
                break;
            }
        }
    }

    io.emit('game_state', { players: players, foods: foods });
}, 1000 / 60);

function handlePlayerDeath(id) {
    if (!players[id]) return;
    let p = players[id];
    for (let i = 0; i < p.body.length; i += 4) {
        if (p.body[i]) {
            foods.push({
                id: Math.random().toString(36).substring(2, 9), 
                x: p.body[i].x + (Math.random()-0.5)*30, y: p.body[i].y + (Math.random()-0.5)*30,
                color: p.color, radius: Math.random() * 4 + 7, isGlowing: true
            });
        }
    }
    io.to(id).emit('player_died');
    delete players[id];
}

// Admin command-line controls interface
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'admin-panel> '
});

http.listen(4000, () => {
    console.log('Physics Server Running 🚀');
    console.log('Admin Panel active. Type "help" for a list of available commands.');
    rl.prompt();
});

rl.on('line', (line) => {
    let input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }
    
    let parts = input.split(/\s+/);
    let command = parts[0].toLowerCase();
    let args = parts.slice(1);
    
    switch (command) {
        case 'list':
            listUsers();
            break;
        case 'ban':
            banUser(args.join(' '));
            break;
        case 'feed':
            feedUser(args[0], args[1]);
            break;
        case 'help':
            console.log('\nAvailable Admin Commands:');
            console.log(' - list                      : Display all active players, lengths, and scores.');
            console.log(' - ban <socket_id_or_name>   : Disconnect and kick a player in real time.');
            console.log(' - feed <socket_id_or_name> <length> : Grow a player\'s snake length immediately.');
            console.log(' - help                      : Show this admin help menu.\n');
            break;
        default:
            console.log(`Unknown command: "${command}". Type "help" for commands.`);
            break;
    }
    rl.prompt();
});

function listUsers() {
    let ids = Object.keys(players);
    if (ids.length === 0) {
        console.log("No players currently online.");
        return;
    }
    console.log("\n======================== ACTIVE PLAYERS LIST ========================");
    console.log("ID\tSOCKET ID\t\tNAME\t\tLENGTH\t\tSCORE");
    console.log("---------------------------------------------------------------------");
    ids.forEach(id => {
        let p = players[id];
        console.log(`${p.shortId}\t${id.padEnd(20)}\t${p.name.padEnd(12)}\t${p.length.toFixed(1)}\t\t${Math.floor(p.length * 10)}`);
    });
    console.log("=====================================================================\n");
}

function banUser(target) {
    if (!target) {
        console.log("Error: Usage is: ban <numeric_id_or_name_or_socket_id>");
        return;
    }
    
    let targetSocketId = null;
    let targetNum = parseInt(target);
    if (!isNaN(targetNum)) {
        let found = Object.values(players).find(p => p.shortId === targetNum);
        if (found) {
            targetSocketId = found.id;
        }
    }
    
    if (!targetSocketId && players[target]) {
        targetSocketId = target;
    }
    
    if (!targetSocketId) {
        let found = Object.values(players).find(p => p.name.toLowerCase() === target.toLowerCase());
        if (found) {
            targetSocketId = found.id;
        }
    }
    
    if (targetSocketId) {
        let name = players[targetSocketId].name;
        let shortId = players[targetSocketId].shortId;
        let socketInstance = io.sockets.sockets.get(targetSocketId);
        if (socketInstance) {
            socketInstance.emit('player_died'); // Trigger client death redirection
            socketInstance.disconnect(true); // Force socket connection drop
            console.log(`Success: Player "${name}" (ID: ${shortId}) has been banned and disconnected.`);
        } else {
            delete players[targetSocketId];
            console.log(`Notice: Connection missing. Removed player "${name}" (ID: ${shortId}) from server memory list.`);
        }
    } else {
        console.log(`Error: Player "${target}" could not be found.`);
    }
}

function feedUser(target, amountStr) {
    if (!target || !amountStr) {
        console.log("Error: Usage is: feed <numeric_id_or_name_or_socket_id> <length>");
        return;
    }
    
    let amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        console.log("Error: Feed amount must be a positive number.");
        return;
    }
    
    let targetSocketId = null;
    let targetNum = parseInt(target);
    if (!isNaN(targetNum)) {
        let found = Object.values(players).find(p => p.shortId === targetNum);
        if (found) {
            targetSocketId = found.id;
        }
    }
    
    if (!targetSocketId && players[target]) {
        targetSocketId = target;
    }
    
    if (!targetSocketId) {
        let found = Object.values(players).find(p => p.name.toLowerCase() === target.toLowerCase());
        if (found) {
            targetSocketId = found.id;
        }
    }
    
    if (targetSocketId) {
        let p = players[targetSocketId];
        p.length += amount;
        console.log(`Success: Fed ${amount} length units to player "${p.name}" (ID: ${p.shortId}). New length: ${p.length.toFixed(1)}`);
    } else {
        console.log(`Error: Player "${target}" could not be found.`);
    }
}