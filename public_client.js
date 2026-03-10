const socket = io();
const $ = (id) => document.getElementById(id);

let me = null;
let roomCode = "";
let hostId = null;

// ---- Screen switching ----
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function showError(msg) {
  $("errorBox").textContent = msg || "";
  if (msg) setTimeout(() => ($("errorBox").textContent = ""), 3000);
}

function isHost() {
  return me && hostId === me;
}

// ---- Join screen ----
$("createBtn").onclick = () => {
  const name = $("nameInput").value.trim();
  let rc = $("roomInput").value.trim().toUpperCase();
  if (!rc) rc = Math.random().toString(36).slice(2, 8).toUpperCase();
  socket.emit("createRoom", { roomCode: rc, name });
};

$("joinBtn").onclick = () => {
  socket.emit("joinRoom", {
    roomCode: $("roomInput").value.trim().toUpperCase(),
    name: $("nameInput").value.trim(),
  });
};

// ---- Lobby ----
$("startBtn").onclick = () => socket.emit("startGame", { roomCode });

// ---- Role ----
$("roleReadyBtn").onclick = () => socket.emit("readyForClue", { roomCode });

// ---- Clue ----
$("sendClueBtn").onclick = () => {
  socket.emit("submitClue", { roomCode, clue: $("clueInput").value.trim() });
  $("clueInput").value = "";
};

// ---- Round end ----
$("nextRoundBtn").onclick = () => socket.emit("hostNextRound", { roomCode });
$("startVoteBtn").onclick = () => socket.emit("hostStartVote", { roomCode });

// ---- Result ----
$("playAgainBtn").onclick = () => socket.emit("playAgain", { roomCode });

// ==== SOCKET EVENTS ====

socket.on("you", ({ socketId, roomCode: rc }) => {
  me = socketId;
  roomCode = rc;
  showScreen("screenLobby");
});

socket.on("roomState", (state) => {
  if (!state) return;
  hostId = state.hostSocketId;

  $("roomBadge").textContent = state.roomCode;

  $("playersList").innerHTML = "";
  state.players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "playerChip";
    div.innerHTML =
      `<span class="pname">${p.name}</span>` +
      (p.socketId === hostId ? `<span class="crown">👑</span>` : "");
    $("playersList").appendChild(div);
  });

  $("lobbyHint").textContent = state.players.length + " player" + (state.players.length !== 1 ? "s" : "") + " in room";

  $("startBtn").classList.toggle("hidden", !(isHost() && !state.game?.started));
});

socket.on("roleData", ({ isImpostor, category, word }) => {
  $("categoryText").textContent = category;
  $("wordText").textContent = isImpostor ? "???" : word;

  if (isImpostor) {
    $("roleBadge").textContent = "🕵️ You are the Impostor";
    $("roleBadge").style.color = "#e85d5d";
  } else {
    $("roleBadge").textContent = "✅ You are a Crewmate";
    $("roleBadge").style.color = "#4ecf73";
  }
});

socket.on("gamePhase", (data) => {
  const { phase } = data;

  if (phase === "lobby") {
    showScreen("screenLobby");
    return;
  }

  if (phase === "role") {
    showScreen("screenRole");
    $("roleReadyBtn").classList.toggle("hidden", !isHost());
    $("roleWait").classList.toggle("hidden", isHost());
    return;
  }

  if (phase === "clue") {
    showScreen("screenClue");
    $("roundText").textContent = data.round;
    $("turnText").textContent = data.turnName || "-";

    const myTurn = me === data.turnSocketId;
    $("clueBox").classList.toggle("hidden", !myTurn);
    $("clueWait").classList.toggle("hidden", myTurn);
    if (myTurn) $("clueInput").focus();
    return;
  }

  if (phase === "roundEnd") {
    showScreen("screenRoundEnd");

    $("clueSummary").innerHTML = "";
    (data.players || []).forEach((p) => {
      const div = document.createElement("div");
      div.className = "voteCard";
      div.innerHTML =
        `<div class="pname">${p.name}</div>` +
        `<div class="clueList">${(p.clues || []).join(" · ") || "no clues yet"}</div>`;
      $("clueSummary").appendChild(div);
    });

    $("hostPick").classList.toggle("hidden", !isHost());
    $("roundEndWait").classList.toggle("hidden", isHost());
    return;
  }

  if (phase === "vote") {
    showScreen("screenVote");

    $("voteList").innerHTML = "";
    (data.players || []).forEach((p) => {
      const div = document.createElement("div");
      div.className = "voteCard";

      const clueStr = (p.clues || []).join(" · ") || "no clues";
      div.innerHTML =
        `<div class="pname">${p.name}</div>` +
        `<div class="clueList">${clueStr}</div>`;

      const btn = document.createElement("button");
      btn.textContent = `Vote ${p.name}`;
      btn.onclick = () => {
        socket.emit("submitVote", { roomCode, targetSocketId: p.socketId });
        // disable all vote buttons after voting
        document.querySelectorAll("#voteList button").forEach((b) => {
          b.disabled = true;
          b.style.opacity = "0.4";
        });
        btn.textContent = `Voted ✓`;
      };
      div.appendChild(btn);
      $("voteList").appendChild(div);
    });

    $("voteProgress").textContent = "";
    return;
  }

  if (phase === "result") {
    showScreen("screenResult");

    const names = Object.fromEntries(data.players.map((p) => [p.socketId, p.name]));

    if (data.crewWon) {
      $("resultTitle").textContent = "🎉 Crew Wins!";
      $("resultTitle").style.color = "#4ecf73";
      $("resultText").textContent = `${names[data.votedOutId]} was the impostor!`;
    } else {
      $("resultTitle").textContent = "🕵️ Impostor Wins!";
      $("resultTitle").style.color = "#e85d5d";
      $("resultText").textContent = `Voted out ${names[data.votedOutId]}, but ${names[data.impostorId]} was the impostor.`;
    }

    $("resultCategory").textContent = data.category;
    $("resultWord").textContent = data.word;

    $("tallyBox").innerHTML = "";
    Object.entries(data.tally).forEach(([id, count]) => {
      const row = document.createElement("div");
      row.className = "tallyRow";
      row.innerHTML = `<span>${names[id] || id}</span><span>${count} vote${count !== 1 ? "s" : ""}</span>`;
      $("tallyBox").appendChild(row);
    });

    $("playAgainBtn").classList.toggle("hidden", !isHost());
    return;
  }
});

socket.on("voteProgress", ({ totalVotes, needed }) => {
  $("voteProgress").textContent = `${totalVotes} / ${needed} voted`;
});

socket.on("errorMsg", (msg) => showError(msg));
