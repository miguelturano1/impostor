const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Your files are in root, so serve root
app.use(express.static(__dirname));

// Home page file is public_index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public_index.html"));
});

// Load words JSON
const wordsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "internet_culture.json"), "utf-8")
);

const rooms = {}; // roomCode -> room state

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sanitizeRoomCode(code = "") {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function roomPublicState(roomCode) {
  const r = rooms[roomCode];
  if (!r) return null;
  return {
    roomCode,
    hostSocketId: r.hostSocketId,
    players: r.players.map((p) => ({ socketId: p.socketId, name: p.name })),
    game: r.game
      ? {
          phase: r.game.phase,
          round: r.game.round,
          turnIndex: r.game.turnIndex,
          started: true,
        }
      : { started: false },
  };
}

function emitRoom(roomCode) {
  io.to(roomCode).emit("roomState", roomPublicState(roomCode));
}

function buildVoteList(room) {
  return room.players.map((p) => ({
    socketId: p.socketId,
    name: p.name,
    clues: room.game.clues[p.socketId] || [],
  }));
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ roomCode, name }) => {
    roomCode = sanitizeRoomCode(
      roomCode || Math.random().toString(36).slice(2, 8).toUpperCase()
    );
    name = (name || "").trim().slice(0, 24);

    if (!name) return socket.emit("errorMsg", "Enter a name.");
    if (!roomCode) return socket.emit("errorMsg", "Invalid room code.");
    if (rooms[roomCode]) return socket.emit("errorMsg", "Room code already exists.");

    rooms[roomCode] = {
      hostSocketId: socket.id,
      players: [{ socketId: socket.id, name }],
      game: null,
    };

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    socket.emit("you", { socketId: socket.id, roomCode });
    emitRoom(roomCode);
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    roomCode = sanitizeRoomCode(roomCode);
    name = (name || "").trim().slice(0, 24);

    const room = rooms[roomCode];
    if (!room) return socket.emit("errorMsg", "Room not found.");
    if (!name) return socket.emit("errorMsg", "Enter a name.");
    if (room.game && room.game.phase !== "lobby") {
      return socket.emit("errorMsg", "Game already started.");
    }

    room.players.push({ socketId: socket.id, name });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    socket.emit("you", { socketId: socket.id, roomCode });
    emitRoom(roomCode);
  });

  socket.on("startGame", ({ roomCode }) => {
    roomCode = sanitizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;
    if (room.players.length < 3)
      return socket.emit("errorMsg", "Need at least 3 players.");

    const category = rand(Object.keys(wordsData));
    const word = rand(wordsData[category]);
    const impostor = rand(room.players);

    room.game = {
      phase: "clue",
      round: 1,
      turnIndex: 0,
      category,
      word,
      impostorSocketId: impostor.socketId,
      clues: {},
      votes: {},
      result: null,
    };

    room.players.forEach((p) => (room.game.clues[p.socketId] = []));

    room.players.forEach((p) => {
      const isImpostor = p.socketId === room.game.impostorSocketId;
      io.to(p.socketId).emit("roleData", {
        isImpostor,
        category: room.game.category,
        word: isImpostor ? null : room.game.word,
      });
    });

    emitRoom(roomCode);
    io.to(roomCode).emit("gameState", {
      phase: room.game.phase,
      round: room.game.round,
      turnSocketId: room.players[room.game.turnIndex].socketId,
      turnName: room.players[room.game.turnIndex].name,
    });
  });

  socket.on("submitClue", ({ roomCode, clue }) => {
    roomCode = sanitizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    if (room.game.phase !== "clue") return;

    const current = room.players[room.game.turnIndex];
    if (!current || current.socketId !== socket.id)
      return socket.emit("errorMsg", "Not your turn.");

    clue = (clue || "").trim().slice(0, 120);
    if (!clue) return socket.emit("errorMsg", "Clue cannot be empty.");

    room.game.clues[socket.id].push(clue);
    room.game.turnIndex++;

    if (room.game.turnIndex >= room.players.length) {
      room.game.turnIndex = 0;
      room.game.phase = "roundEnd";
      io.to(roomCode).emit("roundSummary", {
        round: room.game.round,
        players: buildVoteList(room),
      });
    }

    const turnPlayer = room.players[room.game.turnIndex];
    io.to(roomCode).emit("gameState", {
      phase: room.game.phase,
      round: room.game.round,
      turnSocketId: turnPlayer ? turnPlayer.socketId : null,
      turnName: turnPlayer ? turnPlayer.name : null,
    });
    emitRoom(roomCode);
  });

  socket.on("hostNextRound", ({ roomCode }) => {
    roomCode = sanitizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    if (room.hostSocketId !== socket.id) return;
    if (room.game.phase !== "roundEnd") return;

    room.game.round += 1;
    room.game.phase = "clue";
    room.game.turnIndex = 0;

    const turn = room.players[0];
    io.to(roomCode).emit("gameState", {
      phase: room.game.phase,
      round: room.game.round,
      turnSocketId: turn.socketId,
      turnName: turn.name,
    });
    emitRoom(roomCode);
  });

  socket.on("hostStartVote", ({ roomCode }) => {
    roomCode = sanitizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    if (room.hostSocketId !== socket.id) return;
    if (room.game.phase !== "roundEnd") return;

    room.game.phase = "vote";
    room.game.votes = {};

    io.to(roomCode).emit("voteStart", {
      players: buildVoteList(room),
    });

    io.to(roomCode).emit("gameState", {
      phase: room.game.phase,
      round: room.game.round,
      turnSocketId: null,
      turnName: null,
    });
    emitRoom(roomCode);
  });

  socket.on("submitVote", ({ roomCode, targetSocketId }) => {
    roomCode = sanitizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    if (room.game.phase !== "vote") return;

    if (!room.players.some((p) => p.socketId === targetSocketId)) {
      return socket.emit("errorMsg", "Invalid vote target.");
    }

    room.game.votes[socket.id] = targetSocketId;

    const totalVotes = Object.keys(room.game.votes).length;
    io.to(roomCode).emit("voteProgress", {
      totalVotes,
      needed: room.players.length,
    });

    if (totalVotes === room.players.length) {
      const tally = {};
      for (const votedFor of Object.values(room.game.votes)) {
        tally[votedFor] = (tally[votedFor] || 0) + 1;
      }

      let max = -1;
      let winners = [];
      for (const [id, count] of Object.entries(tally)) {
        if (count > max) {
          max = count;
          winners = [id];
        } else if (count === max) {
          winners.push(id);
        }
      }

      const votedOutId = rand(winners);

      room.game.phase = "result";
      room.game.result = {
        votedOutId,
        impostorId: room.game.impostorSocketId,
        crewWon: votedOutId === room.game.impostorSocketId,
        tally,
      };

      io.to(roomCode).emit("result", {
        votedOutId,
        impostorId: room.game.impostorSocketId,
        crewWon: votedOutId === room.game.impostorSocketId,
        tally,
        word: room.game.word,
        category: room.game.category,
        players: room.players,
      });

      io.to(roomCode).emit("gameState", {
        phase: room.game.phase,
        round: room.game.round,
        turnSocketId: null,
        turnName: null,
      });
      emitRoom(roomCode);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    room.players = room.players.filter((p) => p.socketId !== socket.id);

    if (room.players.length === 0) {
      delete rooms[roomCode];
      return;
    }

    if (room.hostSocketId === socket.id) {
      room.hostSocketId = room.players[0].socketId;
    }

    if (room.game && room.game.phase === "clue") {
      room.game.turnIndex = room.game.turnIndex % room.players.length;
    }

    emitRoom(roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
