const socket = io();

let mySocketId = null;
let roomCode = "";
let currentHostId = null;
let turnSocketId = null;

const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const errorBox = $("errorBox");

const roomCard = $("roomCard");
const roleCard = $("roleCard");
const gameCard = $("gameCard");
const voteCard = $("voteCard");
const resultCard = $("resultCard");

const nameInput = $("nameInput");
const roomInput = $("roomInput");
const roomCodeText = $("roomCodeText");
const hostText = $("hostText");
const playersList = $("playersList");

const startBtn = $("startBtn");
const categoryText = $("categoryText");
const wordText = $("wordText");
const roleBadge = $("roleBadge");

const roundText = $("roundText");
const phaseText = $("phaseText");
const turnText = $("turnText");

const clueBox = $("clueBox");
const clueInput = $("clueInput");

const hostControls = $("hostControls");
const voteList = $("voteList");
const voteProgressText = $("voteProgressText");

const resultText = $("resultText");
const resultCategory = $("resultCategory");
const resultWord = $("resultWord");
const tallyBox = $("tallyBox");

function showError(msg) {
  errorBox.textContent = msg || "";
  if (msg) setTimeout(() => (errorBox.textContent = ""), 2500);
}
function isHost() {
  return mySocketId && currentHostId === mySocketId;
}
function setVisible(el, yes) {
  el.classList.toggle("hidden", !yes);
}

$("createBtn").onclick = () => {
  const name = nameInput.value.trim();
  let rc = roomInput.value.trim().toUpperCase();
  if (!rc) rc = Math.random().toString(36).slice(2, 8).toUpperCase();
  socket.emit("createRoom", { roomCode: rc, name });
};

$("joinBtn").onclick = () => {
  const name = nameInput.value.trim();
  const rc = roomInput.value.trim().toUpperCase();
  socket.emit("joinRoom", { roomCode: rc, name });
};

startBtn.onclick = () => socket.emit("startGame", { roomCode });

$("sendClueBtn").onclick = () => {
  const clue = clueInput.value.trim();
  socket.emit("submitClue", { roomCode, clue });
  clueInput.value = "";
};

$("nextRoundBtn").onclick = () => socket.emit("hostNextRound", { roomCode });
$("startVoteBtn").onclick = () => socket.emit("hostStartVote", { roomCode });

socket.on("connect", () => {
  statusEl.textContent = "Connected";
});

socket.on("you", ({ socketId, roomCode: rc }) => {
  mySocketId = socketId;
  roomCode = rc;
  roomCodeText.textContent = roomCode;
  roomInput.value = roomCode;

  setVisible(roomCard, true);
  setVisible(gameCard, true);
});

socket.on("roomState", (state) => {
  if (!state) return;
  currentHostId = state.hostSocketId;

  roomCodeText.textContent = state.roomCode;
  hostText.textContent = `Host: ${state.players.find(p => p.socketId === state.hostSocketId)?.name || "Unknown"}`;

  playersList.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.socketId === currentHostId ? " 👑" : "");
    playersList.appendChild(li);
  });

  const started = state.game?.started;
  setVisible(startBtn, isHost() && !started);
});

socket.on("roleData", ({ isImpostor, category, word }) => {
  setVisible(roleCard, true);
  categoryText.textContent = category;
  wordText.textContent = isImpostor ? "??? (You are impostor)" : word;
  roleBadge.textContent = isImpostor ? "🕵️ You are the IMPOSTOR" : "✅ You are a normal player";
});

socket.on("gameState", ({ phase, round, turnSocketId: tsid, turnName }) => {
  turnSocketId = tsid;

  phaseText.textContent = phase;
  roundText.textContent = round;
  turnText.textContent = turnName || "-";

  const myTurn = mySocketId && turnSocketId === mySocketId;
  setVisible(clueBox, phase === "clue" && myTurn);

  const hostCanChoose = isHost() && phase === "roundEnd";
  setVisible(hostControls, hostCanChoose);

  setVisible(voteCard, phase === "vote");
  setVisible(resultCard, phase === "result");
});

socket.on("roundSummary", ({ round }) => {
  showError(`Round ${round} done. Host chooses: another round or vote.`);
});

socket.on("voteStart", ({ players }) => {
  setVisible(voteCard, true);
  voteList.innerHTML = "";

  players.forEach((p) => {
    const card = document.createElement("div");
    card.className = "playerCard";

    const title = document.createElement("div");
    title.innerHTML = `<b>${p.name}</b>`;
    card.appendChild(title);

    const clues = document.createElement("div");
    clues.className = "clue";
    clues.textContent = p.clues.length ? p.clues.join(" | ") : "(no clues)";
    card.appendChild(clues);

    const btn = document.createElement("button");
    btn.textContent = `Vote ${p.name}`;
    btn.onclick = () => socket.emit("submitVote", { roomCode, targetSocketId: p.socketId });
    card.appendChild(btn);

    voteList.appendChild(card);
  });
});

socket.on("voteProgress", ({ totalVotes, needed }) => {
  voteProgressText.textContent = `Votes: ${totalVotes}/${needed}`;
});

socket.on("result", ({ votedOutId, impostorId, crewWon, tally, word, category, players }) => {
  setVisible(resultCard, true);

  const nameById = Object.fromEntries(players.map((p) => [p.socketId, p.name]));
  resultText.textContent = crewWon
    ? `Crew wins! Voted out ${nameById[votedOutId]} (the impostor).`
    : `Impostor wins! Voted out ${nameById[votedOutId]}, but impostor was ${nameById[impostorId]}.`;

  resultCategory.textContent = category;
  resultWord.textContent = word;

  tallyBox.innerHTML = "<h3>Vote Tally</h3>";
  Object.entries(tally).forEach(([id, count]) => {
    const p = document.createElement("p");
    p.textContent = `${nameById[id] || id}: ${count}`;
    tallyBox.appendChild(p);
  });
});

socket.on("errorMsg", (msg) => showError(msg));
