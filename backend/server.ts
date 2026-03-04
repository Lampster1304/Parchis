import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from 'url';
import { dbService } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(cors());
  app.use(express.json());

  const PORT = 3000;

  // --- REST API for AUTH & SOCIAL ---

  app.post("/api/auth/register", (req, res) => {
    const { username, email, avatar } = req.body;
    try {
      if (dbService.getUserByEmail(email)) {
        return res.status(400).json({ error: "Email already registered" });
      }
      const user = dbService.createUser(username, email, avatar);
      res.json(user);
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { email } = req.body;
    const user = dbService.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  });

  app.post("/api/auth/update-avatar", (req, res) => {
    const { uid, avatar } = req.body;
    try {
      dbService.updateUserAvatar(uid, avatar);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to update avatar" });
    }
  });

  app.get("/api/social/search", (req, res) => {
    const { q, exclude } = req.query;
    if (!q) return res.json([]);
    const users = dbService.searchUsers(q as string, exclude as string);
    res.json(users);
  });

  app.get("/api/social/friends/:uid", (req, res) => {
    const friends = dbService.getFriends(req.params.uid);
    res.json(friends);
  });

  app.get("/api/social/requests/:uid", (req, res) => {
    const requests = dbService.getFriendRequests(req.params.uid);
    res.json(requests);
  });

  app.post("/api/social/request", (req, res) => {
    const { senderUid, receiverUid } = req.body;
    dbService.sendFriendRequest(senderUid, receiverUid);
    res.json({ success: true });
  });

  app.post("/api/social/accept", (req, res) => {
    const { receiverUid, senderUid } = req.body;
    dbService.acceptFriendRequest(receiverUid, senderUid);
    res.json({ success: true });
  });

  // --- GAME LOGIC (EXISTING) ---
  const rooms = new Map();
  const disconnectTimers = new Map<string, NodeJS.Timeout>(); // key: "roomId:uid"
  const disconnectedPlayers = new Map<string, Set<string>>(); // key: roomId, value: Set of uids

  const advanceTurn = (room: any) => {
    if (!room.gameState) return;
    const state = room.gameState;
    const activePlayers = room.players.map((p: any) => p.color);
    if (activePlayers.length === 0) return;
    const currentIndex = activePlayers.indexOf(state.currentTurn);
    const nextIndex = (currentIndex + 1) % activePlayers.length;
    state.currentTurn = activePlayers[nextIndex];
    state.players.forEach((p: any) => {
      p.isTurn = p.color === state.currentTurn;
    });
    state.lastDiceRoll = null;
    state.bonusSteps = 0;
    state.extraTurns = 0;
    state.consecutiveSixes = 0;
  };

  const EXIT_POSITIONS: Record<string, number> = {
    red: 5, blue: 22, yellow: 39, green: 56
  };
  const SAFE_SQUARES = [0, 5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63];

  // How many squares a token has traveled from its exit position
  const distanceTraveled = (color: string, position: number): number => {
    if (position < 0) return -1;
    const exit = EXIT_POSITIONS[color];
    if (position >= exit) return position - exit;
    return 68 - exit + position;
  };

  // Entry to final path: after 63 squares on main board (positions 68-75), 76 = goal
  const FINAL_ENTRY_DISTANCE = 63;

  const canMoveToken = (token: any, diceTotal: number, color: string, allTokens: any[]): boolean => {
    // Token in home: need a 5 on at least one die to exit
    if (token.position === -1) return false; // handled separately with canExit

    // Token already at goal
    if (token.position === 76) return false;

    // Token on final path (68-75)
    if (token.position >= 68) {
      const newPos = token.position + diceTotal;
      return newPos <= 76; // can't overshoot goal
    }

    // Token on main board
    const traveled = distanceTraveled(color, token.position);
    const newTraveled = traveled + diceTotal;

    if (newTraveled > FINAL_ENTRY_DISTANCE + 8) return false; // overshooting goal
    if (newTraveled > FINAL_ENTRY_DISTANCE) {
      // Entering final path
      const finalPos = 68 + (newTraveled - FINAL_ENTRY_DISTANCE) - 1;
      return finalPos <= 76;
    }

    return true;
  };

  const calculateNewPosition = (token: any, diceTotal: number, color: string): number => {
    if (token.position >= 68) {
      return token.position + diceTotal;
    }

    const traveled = distanceTraveled(color, token.position);
    const newTraveled = traveled + diceTotal;

    if (newTraveled > FINAL_ENTRY_DISTANCE) {
      return 68 + (newTraveled - FINAL_ENTRY_DISTANCE) - 1;
    }

    return (token.position + diceTotal) % 68;
  };

  // Check if a token captures an opponent token at the given position
  const checkCapture = (state: any, movingToken: any, position: number): boolean => {
    if (SAFE_SQUARES.includes(position)) return false; // can't capture on safe squares
    if (position >= 68) return false; // can't capture on final path

    for (const player of state.players) {
      if (player.color === movingToken.color) continue;
      for (const token of player.tokens) {
        if (token.position === position) {
          // Send captured token home
          token.position = -1;
          token.isSafe = true;
          console.log(`${movingToken.color} captured ${player.color} token at position ${position}`);
          return true;
        }
      }
    }
    return false;
  };

  const createInitialState = (room: any) => {
    const players = room.players.map((p: any, idx: number) => {
      const user = dbService.getUserByUid(p.uid);
      console.log(`Creating state for player ${p.uid}: Found user:`, user?.username);
      return {
        id: p.uid,
        username: user?.username || 'Guest',
        avatar: user?.avatar || `https://picsum.photos/seed/${p.uid}/100/100`,
        color: p.color,
        tokens: [
          { id: `${p.color}-1`, color: p.color, position: -1, isSafe: true },
          { id: `${p.color}-2`, color: p.color, position: -1, isSafe: true },
          { id: `${p.color}-3`, color: p.color, position: -1, isSafe: true },
          { id: `${p.color}-4`, color: p.color, position: -1, isSafe: true },
        ],
        isTurn: idx === 0,
        score: 0,
      };
    });

    return {
      players,
      currentTurn: room.players[0]?.color || 'red',
      lastDiceRoll: null,
      status: room.status,
      bonusSteps: 0,
      extraTurns: 0,
      consecutiveSixes: 0,
      roomId: room.id
    };
  };

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, uid }) => {
      console.log(`Join Room Request: room=${roomId}, uid=${uid}`);
      socket.join(roomId);
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { id: roomId, players: [], gameState: null, status: "waiting", creatorId: uid });
      }
      const room = rooms.get(roomId);

      // Check if player is reconnecting (already in room)
      const existingPlayer = room.players.find((p: any) => p.uid === uid);
      if (existingPlayer) {
        // Reconnection: update socketId and cancel disconnect timer
        existingPlayer.socketId = socket.id;
        const timerKey = `${roomId}:${uid}`;
        if (disconnectTimers.has(timerKey)) {
          clearTimeout(disconnectTimers.get(timerKey)!);
          disconnectTimers.delete(timerKey);
          console.log(`Reconnection: cancelled disconnect timer for ${uid} in room ${roomId}`);
        }
        const dcSet = disconnectedPlayers.get(roomId);
        if (dcSet) dcSet.delete(uid);
        socket.emit("player-assigned", existingPlayer.color);
        if (room.gameState) {
          io.to(roomId).emit("room-update", room.gameState);
        } else {
          const currentState = createInitialState(room);
          io.to(roomId).emit("room-update", currentState);
        }
        return;
      }

      // Add new player if room is waiting and not full
      if (room.players.length < 4 && room.status === "waiting") {
        const colors = ["red", "blue", "yellow", "green"];
        const assignedColor = colors[room.players.length];
        room.players.push({ uid, color: assignedColor, socketId: socket.id });
        socket.emit("player-assigned", assignedColor);
        console.log(`Player ${uid} added to room ${roomId} as ${assignedColor}`);
      }

      // Update state for everyone
      const currentState = createInitialState(room);
      io.to(roomId).emit("room-update", currentState);
    });

    socket.on("leave-room", ({ roomId, uid }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      socket.leave(roomId);
      room.players = room.players.filter((p: any) => p.uid !== uid);
      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        const currentState = createInitialState(room);
        io.to(roomId).emit("room-update", currentState);
      }
    });

    socket.on("start-match", (roomId) => {
      const room = rooms.get(roomId);
      if (room && room.players.length >= 2 && room.status === "waiting") {
        room.status = "playing";
        room.gameState = createInitialState(room);
        io.to(roomId).emit("room-update", room.gameState);
      }
    });

    socket.on("roll-dice", ({ roomId, values }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      // Only current turn player can roll
      const rollingPlayer = room.players.find((p: any) => p.socketId === socket.id);
      if (!rollingPlayer || rollingPlayer.color !== state.currentTurn) return;

      // Can't roll if already rolled (must move or end turn first)
      if (state.lastDiceRoll && state.bonusSteps === 0) return;

      const [d1, d2] = values;
      const diceTotal = d1 + d2;
      state.lastDiceRoll = values;

      // Check if doubles (same value on both dice)
      const isDoubles = d1 === d2;
      if (isDoubles) {
        state.consecutiveSixes++;
        // 3 consecutive doubles: last token out goes back home
        if (state.consecutiveSixes >= 3) {
          const currentP = state.players.find((p: any) => p.color === state.currentTurn);
          if (currentP) {
            // Send the last moved token home (or any token on board)
            const tokenOnBoard = [...currentP.tokens].reverse().find((t: any) => t.position >= 0 && t.position < 68);
            if (tokenOnBoard) {
              tokenOnBoard.position = -1;
              tokenOnBoard.isSafe = true;
            }
          }
          state.consecutiveSixes = 0;
          advanceTurn(room);
          io.to(roomId).emit("room-update", state);
          return;
        }
      } else {
        state.consecutiveSixes = 0;
      }

      // Check if player can exit a token (needs a 5 on one die, or sum = 5)
      const canExit = d1 === 5 || d2 === 5 || diceTotal === 5;
      const currentP = state.players.find((p: any) => p.color === state.currentTurn);
      if (!currentP) return;

      const hasTokensHome = currentP.tokens.some((t: any) => t.position === -1);
      const hasTokensOnBoard = currentP.tokens.some((t: any) => t.position >= 0 && t.position !== 76);

      // Check if any move is possible
      let canMove = false;
      if (canExit && hasTokensHome) canMove = true;
      if (hasTokensOnBoard) {
        for (const t of currentP.tokens) {
          if (t.position >= 0 && t.position !== 76 && canMoveToken(t, diceTotal, state.currentTurn, state.players.flatMap((p: any) => p.tokens))) {
            canMove = true;
            break;
          }
        }
      }

      // If no moves possible, auto-advance turn
      if (!canMove) {
        setTimeout(() => {
          if (isDoubles) {
            // Doubles but can't move: still get extra turn
            state.lastDiceRoll = null;
          } else {
            advanceTurn(room);
          }
          io.to(roomId).emit("room-update", state);
        }, 1000);
      }

      io.to(roomId).emit("room-update", state);
    });

    socket.on("move-token", ({ roomId, tokenId }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      // Validate it's the correct player
      const movingPlayer = room.players.find((p: any) => p.socketId === socket.id);
      if (!movingPlayer || movingPlayer.color !== state.currentTurn) return;

      if (!state.lastDiceRoll && state.bonusSteps === 0) return;

      const currentP = state.players.find((p: any) => p.color === state.currentTurn);
      if (!currentP) return;

      const token = currentP.tokens.find((t: any) => t.id === tokenId);
      if (!token) return;

      const [d1, d2] = state.lastDiceRoll || [0, 0];
      const diceTotal = d1 + d2;
      const isDoubles = d1 === d2;

      // Handle bonus steps (from capture or reaching goal)
      if (state.bonusSteps > 0) {
        if (token.position === -1 || token.position === 76) return;
        if (!canMoveToken(token, state.bonusSteps, state.currentTurn, state.players.flatMap((p: any) => p.tokens))) return;

        const newPos = calculateNewPosition(token, state.bonusSteps, state.currentTurn);
        token.position = newPos;
        token.isSafe = SAFE_SQUARES.includes(newPos) || newPos >= 68;
        state.bonusSteps = 0;

        // Check if reached goal
        if (newPos === 76) {
          currentP.score++;
          const allHome = currentP.tokens.every((t: any) => t.position === 76);
          if (allHome) {
            io.to(roomId).emit("game-won", { winnerColor: state.currentTurn, winnerUid: movingPlayer.uid });
            state.status = "finished";
            room.status = "finished";
            io.to(roomId).emit("room-update", state);
            return;
          }
          state.bonusSteps = 10;
          io.to(roomId).emit("room-update", state);
          return;
        }

        // After bonus, advance turn (unless more bonus)
        if (state.bonusSteps === 0) {
          if (!isDoubles) {
            advanceTurn(room);
          } else {
            state.lastDiceRoll = null;
          }
        }
        io.to(roomId).emit("room-update", state);
        return;
      }

      // Exiting from home
      if (token.position === -1) {
        const canExit = d1 === 5 || d2 === 5 || diceTotal === 5;
        if (!canExit) return;

        const exitPos = EXIT_POSITIONS[state.currentTurn];
        token.position = exitPos;
        token.isSafe = true; // exit square is safe

        // Check for capture on exit square
        const captured = checkCapture(state, token, exitPos);
        if (captured) {
          state.bonusSteps = 20;
          io.to(roomId).emit("room-update", state);
          return;
        }

        // After exit, advance turn (doubles = extra turn)
        if (!isDoubles) {
          advanceTurn(room);
        } else {
          state.lastDiceRoll = null;
        }
        io.to(roomId).emit("room-update", state);
        return;
      }

      // Moving on board
      if (token.position === 76) return;
      if (!canMoveToken(token, diceTotal, state.currentTurn, state.players.flatMap((p: any) => p.tokens))) return;

      const newPos = calculateNewPosition(token, diceTotal, state.currentTurn);
      token.position = newPos;
      token.isSafe = SAFE_SQUARES.includes(newPos) || newPos >= 68;

      // Check if reached goal
      if (newPos === 76) {
        currentP.score++;
        const allHome = currentP.tokens.every((t: any) => t.position === 76);
        if (allHome) {
          io.to(roomId).emit("game-won", { winnerColor: state.currentTurn, winnerUid: movingPlayer.uid });
          state.status = "finished";
          room.status = "finished";
          io.to(roomId).emit("room-update", state);
          return;
        }
        state.bonusSteps = 10;
        io.to(roomId).emit("room-update", state);
        return;
      }

      // Check for capture (only on main board, not safe squares)
      if (newPos < 68) {
        const captured = checkCapture(state, token, newPos);
        if (captured) {
          state.bonusSteps = 20;
          io.to(roomId).emit("room-update", state);
          return;
        }
      }

      // Advance turn
      if (!isDoubles) {
        advanceTurn(room);
      } else {
        state.lastDiceRoll = null; // doubles: roll again
      }
      io.to(roomId).emit("room-update", state);
    });

    // --- END TURN (when player can't or doesn't want to move) ---
    socket.on("end-turn", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      const player = room.players.find((p: any) => p.socketId === socket.id);
      if (!player || player.color !== state.currentTurn) return;

      advanceTurn(room);
      io.to(roomId).emit("room-update", state);
    });

    // --- CHECK ROOM (for rejoin detection) ---
    socket.on("check-room", ({ roomId, uid }) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit("check-room-result", { exists: false, canRejoin: false });
        return;
      }
      const player = room.players.find((p: any) => p.uid === uid);
      if (player) {
        socket.emit("check-room-result", {
          exists: true,
          canRejoin: true,
          color: player.color,
          status: room.status,
        });
      } else {
        socket.emit("check-room-result", { exists: true, canRejoin: false, status: room.status });
      }
    });

    // --- REJOIN ROOM ---
    socket.on("rejoin-room", ({ roomId, uid }) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit("rejoin-failed", { reason: "Room no longer exists" });
        return;
      }
      const player = room.players.find((p: any) => p.uid === uid);
      if (!player) {
        socket.emit("rejoin-failed", { reason: "You are no longer in this room" });
        return;
      }
      // Cancel disconnect timer
      const timerKey = `${roomId}:${uid}`;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey)!);
        disconnectTimers.delete(timerKey);
      }
      const dcSet = disconnectedPlayers.get(roomId);
      if (dcSet) dcSet.delete(uid);

      // Update socketId and rejoin socket room
      player.socketId = socket.id;
      socket.join(roomId);
      socket.emit("player-assigned", player.color);
      if (room.gameState) {
        socket.emit("room-update", room.gameState);
      } else {
        socket.emit("room-update", createInitialState(room));
      }
      console.log(`Player ${uid} rejoined room ${roomId} as ${player.color}`);
    });

    // --- SURRENDER ---
    socket.on("surrender", ({ roomId, uid }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.find((p: any) => p.uid === uid);
      if (!player) return;
      const surrenderedColor = player.color;
      const wasTurn = room.gameState?.currentTurn === surrenderedColor;

      // Remove player from room
      room.players = room.players.filter((p: any) => p.uid !== uid);

      // Clean up disconnect timer if any
      const timerKey = `${roomId}:${uid}`;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey)!);
        disconnectTimers.delete(timerKey);
      }

      // Notify remaining players
      io.to(roomId).emit("player-surrendered", { color: surrenderedColor });

      if (room.players.length <= 1) {
        // Game over: last player wins
        if (room.players.length === 1) {
          const winner = room.players[0];
          io.to(roomId).emit("game-won", { winnerColor: winner.color, winnerUid: winner.uid });
        }
        room.status = "finished";
        if (room.gameState) room.gameState.status = "finished";
        io.to(roomId).emit("room-update", room.gameState || createInitialState(room));
        return;
      }

      // Update gameState: remove surrendered player's data
      if (room.gameState) {
        room.gameState.players = room.gameState.players.filter((p: any) => p.color !== surrenderedColor);
        if (wasTurn) {
          advanceTurn(room);
        }
        io.to(roomId).emit("room-update", room.gameState);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      for (const [roomId, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex((p: any) => p.socketId === socket.id);
        if (playerIndex === -1) continue;
        const player = room.players[playerIndex];

        // If game is playing, start grace period instead of removing
        if (room.status === "playing") {
          const timerKey = `${roomId}:${player.uid}`;
          console.log(`Player ${player.uid} disconnected from active game in room ${roomId}. Starting 30s grace period.`);

          // Track as disconnected
          if (!disconnectedPlayers.has(roomId)) {
            disconnectedPlayers.set(roomId, new Set());
          }
          disconnectedPlayers.get(roomId)!.add(player.uid);

          // Start grace timer
          const timer = setTimeout(() => {
            console.log(`Grace period expired for ${player.uid} in room ${roomId}. Removing player.`);
            disconnectTimers.delete(timerKey);
            const dcSet = disconnectedPlayers.get(roomId);
            if (dcSet) dcSet.delete(player.uid);

            const currentRoom = rooms.get(roomId);
            if (!currentRoom) return;

            const surrenderedColor = player.color;
            const wasTurn = currentRoom.gameState?.currentTurn === surrenderedColor;

            currentRoom.players = currentRoom.players.filter((p: any) => p.uid !== player.uid);
            io.to(roomId).emit("player-surrendered", { color: surrenderedColor });

            if (currentRoom.players.length <= 1) {
              if (currentRoom.players.length === 1) {
                const winner = currentRoom.players[0];
                io.to(roomId).emit("game-won", { winnerColor: winner.color, winnerUid: winner.uid });
              }
              currentRoom.status = "finished";
              if (currentRoom.gameState) currentRoom.gameState.status = "finished";
              io.to(roomId).emit("room-update", currentRoom.gameState || createInitialState(currentRoom));
              return;
            }

            if (currentRoom.gameState) {
              currentRoom.gameState.players = currentRoom.gameState.players.filter((p: any) => p.color !== surrenderedColor);
              if (wasTurn) {
                advanceTurn(currentRoom);
              }
              io.to(roomId).emit("room-update", currentRoom.gameState);
            }
          }, 30000);

          disconnectTimers.set(timerKey, timer);
        } else {
          // Waiting room: remove immediately (original behavior)
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            const currentState = createInitialState(room);
            io.to(roomId).emit("room-update", currentState);
          }
        }
      }
    });
  });

  // Serve Frontend in Production
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(process.cwd(), "../frontend/dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "../frontend/dist/index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
