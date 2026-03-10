const socket = io();
const $ = (id) => document.getElementById(id);

let mySocketId = null, roomCode = "", hostId = null;

$("createBtn").onclick = () => {
  const name = $("nameInput").value.trim();
  let rc = $("roomInput").value.trim().toUpperCase();
  if (!rc) rc = Math.random().toString(36).slice(2, 8).toUpperCase();
  socket.emit("createRoom", { roomCode: rc, name });
};

$("joinBtn").onclick = () => {
  socket.emit("joinRoom", {
    roomCode: $("roomInput").value.trim().toUpperCase(),
    name: $("nameInput").value.trim()
  });
};

$("startBtn").onclick = () => socket.emit("startGame", { roomCode });
$("sendClueBtn").onclick = () => {
  socket.emit("submitClue", { roomCode, clue: $("clueInput").value.trim() });
  $("clueInput").value = "";
};
$("nextRoundBtn").onclick = () => socket.emit("hostNextRound", { roomCode });
$("startVoteBtn").onclick = () => socket.emit("hostStartVote", { roomCode });

socket.on("connect", () => $("status").textContent = "Connected");

socket.on("you", ({ socketId, roomCode: rc }) => {
  mySocketId = socketId; roomCode = rc;
  $("roomCodeText").textContent = rc;
  $("roomInput").value = rc;
  $("roomCard").classList.remove("hidden");
  $("gameCard").classList.remove("hidden");
});

socket.on("roomState", (state) => {
  hostId = state.hostSocketId;
  $("hostText").textContent = "Host: " + (state.players.find(p => p.socketId === hostId)?.name || "Unknown");
  $("playersList").innerHTML = "";
  state.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.socketId === hostId ? " 👑" : "");
    $("playersList").appendChild(li);
  });
  $("startBtn").classList.toggle("hidden", !(mySocketId === hostId && !state.game?.started));
});

socket.on("roleData", ({ isImpostor, category, word }) => {
  $("roleCard").classList.remove("hidden");
  $("categoryText").textContent = category;
  $("wordText").textContent = isImpostor ? "??? (Impostor)" : word;
  $("roleBadge").textContent = isImpostor ? "🕵️ You are the IMPOSTOR" : "✅ Normal player";
});

socket.on("gameState", ({ phase, round, turnSocketId, turnName }) => {
  $("phaseText").textContent = phase;
  $("roundText").textContent = round;
  $("turnText").textContent = turnName || "-";

  const myTurn = mySocketId === turnSocketId;
  $("clueBox").classList.toggle("hidden", !(phase === "clue" && myTurn));
  $("hostControls").classList.toggle("hidden", !(phase === "roundEnd" && mySocketId === hostId));
});

socket.on("voteStart", ({ players }) => {
  $("voteCard").classList.remove("hidden");
  $("voteList").innerHTML = "";
  players.forEach(p => {
    const div = document.createElement("div");
    div.className = "playerCard";
    div.innerHTML = `<b>${p.name}</b><br><small>${(p.clues || []).join(" | ") || "(no clues)"}</small>`;
    const btn = document.createElement("button");
    btn.textContent = "Vote";
    btn.onclick = () => socket.emit("submitVote", { roomCode, targetSocketId: p.socketId });
    div.appendChild(btn);
    $("voteList").appendChild(div);
  });
});

socket.on("voteProgress", ({ totalVotes, needed }) => {
  $("voteProgressText").textContent = `Votes: ${totalVotes}/${needed}`;
});

socket.on("result", ({ votedOutId, impostorId, crewWon, tally, word, category, players }) => {
  const names = Object.fromEntries(players.map(p => [p.socketId, p.name]));
  $("resultCard").classList.remove("hidden");
  $("resultText").textContent = crewWon
    ? `Crew wins! ${names[votedOutId]} was impostor.`
    : `Impostor wins! Voted ${names[votedOutId]}, impostor was ${names[impostorId]}.`;
  $("resultCategory").textContent = category;
  $("resultWord").textContent = word;
  $("tallyBox").innerHTML = Object.entries(tally).map(([id,c]) => `<p>${names[id]}: ${c}</p>`).join("");
});

socket.on("errorMsg", (msg) => $("errorBox").textContent = msg);
