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

  const PORT = Number(process.env.PORT) || 3005;

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

  // ========================================
  // PARCHÍS GAME LOGIC (100% Authentic)
  // ========================================

  const rooms = new Map();
  const disconnectTimers = new Map<string, NodeJS.Timeout>();
  const disconnectedPlayers = new Map<string, Set<string>>();

  // --- CONSTANTS ---
  const BOARD_SIZE = 68; // 68 squares on main path
  const FINAL_PATH_LENGTH = 7; // 7 squares in final corridor (positions 69-75)
  const GOAL_POSITION = 76;
  const HOME_POSITION = -1;

  // Exit positions per color (where tokens enter the main board)
  const EXIT_POSITIONS: Record<string, number> = {
    green: 1, yellow: 18, blue: 35, red: 52
  };

  // Safe squares: 4 exits + 8 marked safe squares
  const SAFE_SQUARES = [1, 5, 12, 18, 22, 29, 35, 39, 46, 52, 56, 63];

  // Entry to final path: square just before entering the corridor
  // Each color enters after completing ~63 squares from their exit
  const FINAL_ENTRY_SQUARES: Record<string, number> = {
    green: 64, blue: 30, red: 47, yellow: 13
  };

  // --- UTILITY FUNCTIONS ---

  // Distance a token has traveled from its exit position on the main board
  const distanceTraveled = (color: string, position: number): number => {
    if (position <= 0) return -1;
    if (position > BOARD_SIZE) return -1; // on final path or goal
    const exit = EXIT_POSITIONS[color];
    if (position >= exit) return position - exit;
    return BOARD_SIZE - exit + position;
  };

  // Check if a position has a barrier (2 same-color tokens)
  const getBarrierAt = (state: any, position: number): string | null => {
    if (position <= 0 || position > BOARD_SIZE) return null;
    const tokensByColor: Record<string, number> = {};
    for (const player of state.players) {
      for (const token of player.tokens) {
        if (token.position === position) {
          tokensByColor[player.color] = (tokensByColor[player.color] || 0) + 1;
          if (tokensByColor[player.color] >= 2) return player.color;
        }
      }
    }
    return null;
  };

  // Count tokens at a position
  const countTokensAt = (state: any, position: number): number => {
    let count = 0;
    for (const player of state.players) {
      for (const token of player.tokens) {
        if (token.position === position) count++;
      }
    }
    return count;
  };

  // Check if the path from current position is blocked by any barrier
  const isPathBlocked = (state: any, fromPos: number, steps: number, color: string): boolean => {
    if (fromPos <= 0 || fromPos > BOARD_SIZE) return false;

    const traveled = distanceTraveled(color, fromPos);

    for (let i = 1; i <= steps; i++) {
      const checkTraveled = traveled + i;

      // If entering final path, no barriers there
      if (checkTraveled > 63) break;

      const checkPos = (fromPos + i - 1) % BOARD_SIZE + 1;
      const barrier = getBarrierAt(state, checkPos);
      if (barrier !== null) {
        return true; // Any barrier blocks the path (even own)
      }
    }
    return false;
  };

  // Calculate new position for a token moving by `steps`
  const calculateNewPosition = (token: any, steps: number, color: string): number => {
    // Token on final path
    if (token.position > BOARD_SIZE && token.position < GOAL_POSITION) {
      const newPos = token.position + steps;
      return newPos <= GOAL_POSITION ? newPos : -999; // -999 = invalid (overshoot)
    }

    // Token on main board
    const traveled = distanceTraveled(color, token.position);
    const newTraveled = traveled + steps;

    if (newTraveled > 63 + FINAL_PATH_LENGTH) return -999; // Overshoot goal

    if (newTraveled > 63) {
      // Entering final corridor
      return BOARD_SIZE + (newTraveled - 63); // 69-75 final path, 76 = goal
    }

    // Normal movement on main board (1-68)
    let newPos = (token.position + steps - 1) % BOARD_SIZE + 1;
    return newPos;
  };

  // Check if a single die value can be used to move a specific token
  const canMoveTokenWithDie = (state: any, token: any, dieValue: number, color: string): boolean => {
    if (token.position === HOME_POSITION) return false; // Exit is handled separately
    if (token.position === GOAL_POSITION) return false;

    const newPos = calculateNewPosition(token, dieValue, color);
    if (newPos === -999) return false; // Overshoot

    // Check barriers on the path
    if (token.position >= 1 && token.position <= BOARD_SIZE) {
      if (isPathBlocked(state, token.position, dieValue, color)) return false;
    }

    // Check destination: can't land on a barrier
    if (newPos >= 1 && newPos <= BOARD_SIZE) {
      const barrier = getBarrierAt(state, newPos);
      if (barrier !== null) return false;

      // Safe square: max 2 tokens, can't capture
      if (SAFE_SQUARES.includes(newPos)) {
        if (countTokensAt(state, newPos) >= 2) return false;
      }
    }

    return true;
  };

  // Check if player can exit a token from home
  const canExitToken = (state: any, color: string, dieValue: number): boolean => {
    if (dieValue !== 5) return false;
    const player = state.players.find((p: any) => p.color === color);
    if (!player) return false;
    const hasTokenHome = player.tokens.some((t: any) => t.position === HOME_POSITION);
    if (!hasTokenHome) return false;

    // Check if exit square is blocked by barrier
    const exitPos = EXIT_POSITIONS[color];
    const barrier = getBarrierAt(state, exitPos);
    if (barrier !== null) return false;

    // Safe square limit: max 2 tokens on exit
    if (countTokensAt(state, exitPos) >= 2) return false;

    return true;
  };

  const canExitWithDiceSum = (state: any, color: string, remainingDice: number[]): boolean => {
    if (remainingDice.length !== 2) return false;
    if (remainingDice[0] + remainingDice[1] !== 5) return false;
    return canExitToken(state, color, 5);
  };

  // Check capture at position (returns true if captured)
  const checkCapture = (state: any, movingColor: string, position: number): boolean => {
    if (position <= 0 || position > BOARD_SIZE) return false;
    if (SAFE_SQUARES.includes(position)) return false;

    for (const player of state.players) {
      if (player.color === movingColor) continue;
      for (const token of player.tokens) {
        if (token.position === position) {
          token.position = HOME_POSITION;
          token.isSafe = true;
          console.log(`[PARCHÍS] ${movingColor} captured ${player.color} token at position ${position}`);
          return true;
        }
      }
    }
    return false;
  };

  // Find all barriers belonging to a color
  const getPlayerBarriers = (state: any, color: string): number[] => {
    const positions: Record<number, number> = {};
    const player = state.players.find((p: any) => p.color === color);
    if (!player) return [];
    for (const token of player.tokens) {
      if (token.position >= 1 && token.position <= BOARD_SIZE) {
        positions[token.position] = (positions[token.position] || 0) + 1;
      }
    }
    return Object.entries(positions)
      .filter(([_, count]) => count >= 2)
      .map(([pos]) => parseInt(pos));
  };

  // Check if a barrier can be opened with a specific die value
  const canBreakBarrierWithDie = (state: any, color: string, dieValue: number): boolean => {
    const player = state.players.find((p: any) => p.color === color);
    if (!player) return false;
    const barriers = getPlayerBarriers(state, color);
    if (barriers.length === 0) return false;

    for (const barrierPos of barriers) {
      for (const token of player.tokens) {
        if (token.position === barrierPos) {
          if (canMoveTokenWithDie(state, token, dieValue, color)) return true;
        }
      }
    }
    return false;
  };

  // Check if any move is possible for the current player
  const hasAnyValidMove = (state: any, dieValue: number, color: string, remainingDice: number[] = []): boolean => {
    const player = state.players.find((p: any) => p.color === color);
    if (!player) return false;

    // Check exit
    if (canExitToken(state, color, dieValue)) return true;
    if (canExitWithDiceSum(state, color, remainingDice)) return true;

    // Check movement of any token on board
    for (const token of player.tokens) {
      if (token.position !== HOME_POSITION && token.position !== GOAL_POSITION) {
        if (canMoveTokenWithDie(state, token, dieValue, color)) return true;
      }
    }
    return false;
  };

  const resetTurnTimer = (state: any) => {
    state.turnTimerVersion = (state.turnTimerVersion || 0) + 1;
  };

  // Advance to next player's turn
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
    state.remainingDice = [];
    state.bonusSteps = 0;
    state.consecutiveDoubles = 0;
    state.mustBreakBarrier = false;
    resetTurnTimer(state);
  };

  // Finish using all dice and decide turn outcome
  const finishDiceUsage = (room: any, isDoubles: boolean) => {
    const state = room.gameState;
    state.mustBreakBarrier = false;
    if (isDoubles) {
      // Doubles: player gets another roll (don't advance turn)
      state.lastDiceRoll = null;
      state.remainingDice = [];
      resetTurnTimer(state);
    } else {
      advanceTurn(room);
    }
  };

  const createInitialState = (room: any) => {
    const players = room.players.map((p: any, idx: number) => {
      const user = dbService.getUserByUid(p.uid);
      return {
        id: p.uid,
        username: user?.username || 'Guest',
        avatar: user?.avatar || `https://picsum.photos/seed/${p.uid}/100/100`,
        color: p.color,
        tokens: [
          { id: `${p.color}-1`, color: p.color, position: HOME_POSITION, isSafe: true },
          { id: `${p.color}-2`, color: p.color, position: HOME_POSITION, isSafe: true },
          { id: `${p.color}-3`, color: p.color, position: HOME_POSITION, isSafe: true },
          { id: `${p.color}-4`, color: p.color, position: HOME_POSITION, isSafe: true },
        ],
        isTurn: idx === 0,
        score: 0,
      };
    });

    return {
      players,
      currentTurn: room.players[0]?.color || 'red',
      lastDiceRoll: null,
      remainingDice: [],
      status: room.status,
      bonusSteps: 0,
      consecutiveDoubles: 0,
      mustBreakBarrier: false,
      turnTimerVersion: 0,
      roomId: room.id
    };
  };

  const autoPlayTurn = (room: any, roomId: string) => {
    if (!room?.gameState || room.status !== "playing") return;
    const state = room.gameState;
    if (state.status !== "playing") return;

    // Auto-roll if player has not rolled yet
    if (state.remainingDice.length === 0 && state.bonusSteps <= 0) {
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      const isDoubles = d1 === d2;
      state.lastDiceRoll = [d1, d2];

      if (isDoubles) {
        state.consecutiveDoubles++;
        if (state.consecutiveDoubles >= 3) {
          const currentP = state.players.find((p: any) => p.color === state.currentTurn);
          if (currentP) {
            const tokenOnBoard = [...currentP.tokens]
              .reverse()
              .find((t: any) => t.position >= 1 && t.position <= BOARD_SIZE);
            if (tokenOnBoard) {
              tokenOnBoard.position = HOME_POSITION;
              tokenOnBoard.isSafe = true;
            }
          }
          state.consecutiveDoubles = 0;
          advanceTurn(room);
          io.to(roomId).emit("room-update", state);
          return;
        }
      } else {
        state.consecutiveDoubles = 0;
      }

      const playerBarriers = getPlayerBarriers(state, state.currentTurn);
      state.mustBreakBarrier = isDoubles && playerBarriers.length > 0;
      state.remainingDice = [d1, d2];
      resetTurnTimer(state);

      const canMoveD1 = state.mustBreakBarrier
        ? canBreakBarrierWithDie(state, state.currentTurn, d1)
        : hasAnyValidMove(state, d1, state.currentTurn, state.remainingDice);
      const canMoveD2 = state.mustBreakBarrier
        ? canBreakBarrierWithDie(state, state.currentTurn, d2)
        : hasAnyValidMove(state, d2, state.currentTurn, state.remainingDice);

      if (!canMoveD1 && !canMoveD2) {
        setTimeout(() => {
          state.mustBreakBarrier = false;
          if (isDoubles) {
            state.lastDiceRoll = null;
            state.remainingDice = [];
            resetTurnTimer(state);
          } else {
            advanceTurn(room);
          }
          io.to(roomId).emit("room-update", state);
        }, 1500);
        io.to(roomId).emit("room-update", state);
        return;
      }
    }

    if (!room?.gameState || room.status !== "playing") return;
    const freshState = room.gameState;
    const currentP = freshState.players.find((p: any) => p.color === freshState.currentTurn);
    if (!currentP) return;
    const [d1, d2] = freshState.lastDiceRoll || [0, 0];
    const isDoubles = d1 === d2;
    const playerBarriers = getPlayerBarriers(freshState, freshState.currentTurn);

    // Bonus move first (capture/goal bonus)
    if (freshState.bonusSteps > 0) {
      const bonus = freshState.bonusSteps;
      const token = currentP.tokens.find((t: any) =>
        t.position !== HOME_POSITION &&
        t.position !== GOAL_POSITION &&
        (!freshState.mustBreakBarrier || playerBarriers.includes(t.position)) &&
        canMoveTokenWithDie(freshState, t, bonus, freshState.currentTurn)
      );

      if (!token) {
        freshState.bonusSteps = 0;
        if (freshState.remainingDice.length === 0) {
          finishDiceUsage(room, isDoubles);
        } else {
          resetTurnTimer(freshState);
        }
        io.to(roomId).emit("room-update", freshState);
        return;
      }

      const newPos = calculateNewPosition(token, bonus, freshState.currentTurn);
      if (newPos === -999) {
        freshState.bonusSteps = 0;
        io.to(roomId).emit("room-update", freshState);
        return;
      }

      const tokenStartedInBarrier = playerBarriers.includes(token.position);
      token.position = newPos;
      token.isSafe = SAFE_SQUARES.includes(newPos) || newPos > BOARD_SIZE;
      if (freshState.mustBreakBarrier && tokenStartedInBarrier) freshState.mustBreakBarrier = false;
      freshState.bonusSteps = 0;
      resetTurnTimer(freshState);

      if (newPos === GOAL_POSITION) {
        currentP.score++;
        if (currentP.tokens.every((t: any) => t.position === GOAL_POSITION)) {
          const winner = room.players.find((p: any) => p.color === freshState.currentTurn);
          io.to(roomId).emit("game-won", { winnerColor: freshState.currentTurn, winnerUid: winner?.uid });
          freshState.status = "finished";
          room.status = "finished";
          io.to(roomId).emit("room-update", freshState);
          return;
        }
        freshState.bonusSteps = 10;
        io.to(roomId).emit("room-update", freshState);
        return;
      }

      if (newPos >= 1 && newPos <= BOARD_SIZE && checkCapture(freshState, freshState.currentTurn, newPos)) {
        freshState.bonusSteps = 20;
        io.to(roomId).emit("room-update", freshState);
        return;
      }

      if (freshState.remainingDice.length === 0) {
        finishDiceUsage(room, isDoubles);
      }
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    if (freshState.remainingDice.length === 0) {
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    // Try exit from home with 5 (single die) or dice sum = 5
    const canExitBySumFive = freshState.remainingDice.length === 2 &&
      (freshState.remainingDice[0] + freshState.remainingDice[1] === 5);
    const homeToken = currentP.tokens.find((t: any) => t.position === HOME_POSITION);
    if (homeToken && !freshState.mustBreakBarrier &&
      (freshState.remainingDice.includes(5) || canExitBySumFive) &&
      canExitToken(freshState, freshState.currentTurn, 5)) {
      const exitPos = EXIT_POSITIONS[freshState.currentTurn];
      homeToken.position = exitPos;
      homeToken.isSafe = true;
      resetTurnTimer(freshState);

      if (freshState.remainingDice.includes(5)) {
        const idx = freshState.remainingDice.indexOf(5);
        freshState.remainingDice.splice(idx, 1);
      } else {
        freshState.remainingDice = [];
      }

      if (checkCapture(freshState, freshState.currentTurn, exitPos)) {
        freshState.bonusSteps = 20;
        io.to(roomId).emit("room-update", freshState);
        return;
      }

      if (freshState.remainingDice.length === 0) {
        finishDiceUsage(room, isDoubles);
      }
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    // Try standard token movement
    let selectedDie: number | null = null;
    let selectedToken: any = null;
    for (const die of [...freshState.remainingDice]) {
      for (const token of currentP.tokens) {
        if (token.position === HOME_POSITION || token.position === GOAL_POSITION) continue;
        if (freshState.mustBreakBarrier && !playerBarriers.includes(token.position)) continue;
        if (!canMoveTokenWithDie(freshState, token, die, freshState.currentTurn)) continue;
        selectedDie = die;
        selectedToken = token;
        break;
      }
      if (selectedToken) break;
    }

    // If no move found, auto-pass first die
    if (!selectedToken || selectedDie === null) {
      const dieToPass = freshState.remainingDice[0];
      const idx = freshState.remainingDice.indexOf(dieToPass);
      if (idx >= 0) freshState.remainingDice.splice(idx, 1);
      if (freshState.remainingDice.length > 0) {
        resetTurnTimer(freshState);
      } else {
        finishDiceUsage(room, isDoubles);
      }
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    const newPos = calculateNewPosition(selectedToken, selectedDie, freshState.currentTurn);
    if (newPos === -999) {
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    const tokenStartedInBarrier = playerBarriers.includes(selectedToken.position);
    selectedToken.position = newPos;
    selectedToken.isSafe = SAFE_SQUARES.includes(newPos) || newPos > BOARD_SIZE;
    if (freshState.mustBreakBarrier && tokenStartedInBarrier) freshState.mustBreakBarrier = false;
    resetTurnTimer(freshState);

    const dieIdx = freshState.remainingDice.indexOf(selectedDie);
    if (dieIdx >= 0) freshState.remainingDice.splice(dieIdx, 1);

    if (newPos === GOAL_POSITION) {
      currentP.score++;
      if (currentP.tokens.every((t: any) => t.position === GOAL_POSITION)) {
        const winner = room.players.find((p: any) => p.color === freshState.currentTurn);
        io.to(roomId).emit("game-won", { winnerColor: freshState.currentTurn, winnerUid: winner?.uid });
        freshState.status = "finished";
        room.status = "finished";
        io.to(roomId).emit("room-update", freshState);
        return;
      }
      freshState.bonusSteps = 10;
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    if (newPos >= 1 && newPos <= BOARD_SIZE && checkCapture(freshState, freshState.currentTurn, newPos)) {
      freshState.bonusSteps = 20;
      io.to(roomId).emit("room-update", freshState);
      return;
    }

    if (freshState.remainingDice.length === 0) {
      finishDiceUsage(room, isDoubles);
    }
    io.to(roomId).emit("room-update", freshState);
  };

  // ========================================
  // SOCKET HANDLERS
  // ========================================

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, uid }) => {
      console.log(`Join Room: room=${roomId}, uid=${uid}`);
      socket.join(roomId);
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { id: roomId, players: [], gameState: null, status: "waiting", creatorId: uid });
      }
      const room = rooms.get(roomId);

      // Reconnection check
      const existingPlayer = room.players.find((p: any) => p.uid === uid);
      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        const timerKey = `${roomId}:${uid}`;
        if (disconnectTimers.has(timerKey)) {
          clearTimeout(disconnectTimers.get(timerKey)!);
          disconnectTimers.delete(timerKey);
        }
        const dcSet = disconnectedPlayers.get(roomId);
        if (dcSet) dcSet.delete(uid);
        socket.emit("player-assigned", existingPlayer.color);
        if (room.gameState) {
          io.to(roomId).emit("room-update", room.gameState);
        } else {
          io.to(roomId).emit("room-update", createInitialState(room));
        }
        return;
      }

      // New player
      if (room.players.length < 4 && room.status === "waiting") {
        const colors = ["red", "green", "yellow", "blue"];
        const assignedColor = colors[room.players.length];
        room.players.push({ uid, color: assignedColor, socketId: socket.id });
        socket.emit("player-assigned", assignedColor);
      }

      const isPublicRoom = roomId.startsWith("public-");
      if (isPublicRoom && room.status === "waiting" && room.players.length === 4) {
        room.status = "playing";
        room.gameState = createInitialState(room);
        io.to(roomId).emit("room-update", room.gameState);
        return;
      }

      if (room.gameState) {
        io.to(roomId).emit("room-update", room.gameState);
        return;
      }

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
        io.to(roomId).emit("room-update", createInitialState(room));
      }
    });

    socket.on("start-match", (roomId) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== "waiting") return;
      const isPublicRoom = roomId.startsWith("public-");
      const minPlayers = isPublicRoom ? 4 : 2;
      if (room.players.length < minPlayers) return;

      room.status = "playing";
      room.gameState = createInitialState(room);
      io.to(roomId).emit("room-update", room.gameState);
    });

    // ========================================
    // ROLL DICE - Parchís: 2 dice, each used separately
    // ========================================
    socket.on("roll-dice", ({ roomId, values }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      const rollingPlayer = room.players.find((p: any) => p.socketId === socket.id);
      if (!rollingPlayer || rollingPlayer.color !== state.currentTurn) return;

      // Can't roll if dice are still remaining to be used
      if (state.remainingDice.length > 0) return;
      // Can't roll if bonus steps pending
      if (state.bonusSteps > 0) return;

      const [d1, d2] = values;
      const isDoubles = d1 === d2;

      state.lastDiceRoll = values;

      // Track consecutive doubles
      if (isDoubles) {
        state.consecutiveDoubles++;

        // 3 consecutive doubles: penalty - last token on board goes home
        if (state.consecutiveDoubles >= 3) {
          const currentP = state.players.find((p: any) => p.color === state.currentTurn);
          if (currentP) {
            const tokenOnBoard = [...currentP.tokens]
              .reverse()
              .find((t: any) => t.position >= 1 && t.position <= BOARD_SIZE);
            if (tokenOnBoard) {
              tokenOnBoard.position = HOME_POSITION;
              tokenOnBoard.isSafe = true;
              console.log(`[PARCHÍS] 3 doubles! ${state.currentTurn} token sent home`);
            }
          }
          state.consecutiveDoubles = 0;
          advanceTurn(room);
          io.to(roomId).emit("room-update", state);
          return;
        }
      } else {
        state.consecutiveDoubles = 0;
      }

      // PARCHÍS RULE: If player has a barrier and rolls doubles, they MUST break it
      const playerBarriers = getPlayerBarriers(state, state.currentTurn);
      const mustBreakBarrier = isDoubles && playerBarriers.length > 0;
      state.mustBreakBarrier = mustBreakBarrier;

      // Set remaining dice (each die is used individually)
      state.remainingDice = [d1, d2];
      resetTurnTimer(state);

      // Check if player has any valid move with either die
      const canMoveD1 = mustBreakBarrier
        ? canBreakBarrierWithDie(state, state.currentTurn, d1)
        : hasAnyValidMove(state, d1, state.currentTurn, state.remainingDice);
      const canMoveD2 = mustBreakBarrier
        ? canBreakBarrierWithDie(state, state.currentTurn, d2)
        : hasAnyValidMove(state, d2, state.currentTurn, state.remainingDice);

      if (!canMoveD1 && !canMoveD2) {
        // No moves possible: auto-advance
        setTimeout(() => {
          state.mustBreakBarrier = false;
          if (isDoubles) {
            state.lastDiceRoll = null;
            state.remainingDice = [];
            resetTurnTimer(state);
          } else {
            advanceTurn(room);
          }
          io.to(roomId).emit("room-update", state);
        }, 1500);
      }

      io.to(roomId).emit("room-update", state);
    });

    // ========================================
    // MOVE TOKEN - Parchís: move using a specific die value
    // ========================================
    socket.on("move-token", ({ roomId, tokenId, dieValue }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      const movingPlayer = room.players.find((p: any) => p.socketId === socket.id);
      if (!movingPlayer || movingPlayer.color !== state.currentTurn) return;

      const currentP = state.players.find((p: any) => p.color === state.currentTurn);
      if (!currentP) return;

      const token = currentP.tokens.find((t: any) => t.id === tokenId);
      if (!token) return;

      const [d1, d2] = state.lastDiceRoll || [0, 0];
      const isDoubles = d1 === d2;
      const playerBarriers = getPlayerBarriers(state, state.currentTurn);
      const tokenStartsInBarrier = playerBarriers.includes(token.position);
      if (state.mustBreakBarrier && !tokenStartsInBarrier) return;

      // --- HANDLE BONUS STEPS (from capture or goal) ---
      if (state.bonusSteps > 0) {
        if (token.position === HOME_POSITION || token.position === GOAL_POSITION) return;
        if (!canMoveTokenWithDie(state, token, state.bonusSteps, state.currentTurn)) return;

        const newPos = calculateNewPosition(token, state.bonusSteps, state.currentTurn);
        if (newPos === -999) return;

        token.position = newPos;
        token.isSafe = SAFE_SQUARES.includes(newPos) || newPos > BOARD_SIZE;
        if (state.mustBreakBarrier && tokenStartsInBarrier) state.mustBreakBarrier = false;
        state.bonusSteps = 0;
        resetTurnTimer(state);

        // Check goal
        if (newPos === GOAL_POSITION) {
          currentP.score++;
          if (currentP.tokens.every((t: any) => t.position === GOAL_POSITION)) {
            io.to(roomId).emit("game-won", { winnerColor: state.currentTurn, winnerUid: movingPlayer.uid });
            state.status = "finished";
            room.status = "finished";
            io.to(roomId).emit("room-update", state);
            return;
          }
          state.bonusSteps = 10; // Goal bonus
          io.to(roomId).emit("room-update", state);
          return;
        }

        // Check capture after bonus move
        if (newPos >= 1 && newPos <= BOARD_SIZE) {
          if (checkCapture(state, state.currentTurn, newPos)) {
            state.bonusSteps = 20; // Capture bonus
            io.to(roomId).emit("room-update", state);
            return;
          }
        }

        // Bonus used, check if dice still remaining
        if (state.remainingDice.length > 0) {
          io.to(roomId).emit("room-update", state);
          return;
        }

        finishDiceUsage(room, isDoubles);
        io.to(roomId).emit("room-update", state);
        return;
      }

      // --- NORMAL MOVE: validate dieValue is in remainingDice ---
      const usesSingleDie = state.remainingDice.includes(dieValue);
      const usesSumFiveExit = token.position === HOME_POSITION &&
        dieValue === 5 &&
        canExitWithDiceSum(state, state.currentTurn, state.remainingDice);
      if (!usesSingleDie && !usesSumFiveExit) return;

      // --- EXIT FROM HOME: requires a 5 ---
      if (token.position === HOME_POSITION) {
        if (dieValue !== 5) return;
        if (!canExitToken(state, state.currentTurn, 5)) return;

        const exitPos = EXIT_POSITIONS[state.currentTurn];
        token.position = exitPos;
        token.isSafe = true;
        resetTurnTimer(state);

        if (state.remainingDice.includes(5)) {
          // Exit with single die showing 5
          const dieIdx = state.remainingDice.indexOf(5);
          state.remainingDice.splice(dieIdx, 1);
        } else if (usesSumFiveExit) {
          // Exit with sum of both dice (2+3 or 1+4)
          state.remainingDice = [];
        } else {
          return;
        }

        // Check capture on exit
        if (checkCapture(state, state.currentTurn, exitPos)) {
          state.bonusSteps = 20;
          io.to(roomId).emit("room-update", state);
          return;
        }

        // If no more dice to use, finish
        if (state.remainingDice.length === 0) {
          finishDiceUsage(room, isDoubles);
        }
        io.to(roomId).emit("room-update", state);
        return;
      }

      // --- MOVE ON BOARD ---
      if (token.position === GOAL_POSITION) return;
      if (!canMoveTokenWithDie(state, token, dieValue, state.currentTurn)) return;

      const newPos = calculateNewPosition(token, dieValue, state.currentTurn);
      if (newPos === -999) return;

      token.position = newPos;
      token.isSafe = SAFE_SQUARES.includes(newPos) || newPos > BOARD_SIZE;
      if (state.mustBreakBarrier && tokenStartsInBarrier) state.mustBreakBarrier = false;
      resetTurnTimer(state);

      // Remove this die from remaining
      const dieIdx = state.remainingDice.indexOf(dieValue);
      state.remainingDice.splice(dieIdx, 1);

      // Check goal
      if (newPos === GOAL_POSITION) {
        currentP.score++;
        if (currentP.tokens.every((t: any) => t.position === GOAL_POSITION)) {
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

      // Check capture
      if (newPos >= 1 && newPos <= BOARD_SIZE) {
        if (checkCapture(state, state.currentTurn, newPos)) {
          state.bonusSteps = 20;
          io.to(roomId).emit("room-update", state);
          return;
        }
      }

      // If no more dice, finish
      if (state.remainingDice.length === 0) {
        finishDiceUsage(room, isDoubles);
      }
      io.to(roomId).emit("room-update", state);
    });

    // --- PASS DIE: skip using a specific die when no valid move ---
    socket.on("pass-die", ({ roomId, dieValue }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      const player = room.players.find((p: any) => p.socketId === socket.id);
      if (!player || player.color !== state.currentTurn) return;

      if (!state.remainingDice.includes(dieValue)) return;

      // Only allow passing if the die truly has no valid move
      if (state.mustBreakBarrier) {
        if (canBreakBarrierWithDie(state, state.currentTurn, dieValue)) return;
      } else if (hasAnyValidMove(state, dieValue, state.currentTurn, state.remainingDice)) return;

      const dieIdx = state.remainingDice.indexOf(dieValue);
      state.remainingDice.splice(dieIdx, 1);
      if (state.remainingDice.length > 0) {
        resetTurnTimer(state);
      }

      const [d1, d2] = state.lastDiceRoll || [0, 0];
      const isDoubles = d1 === d2;

      if (state.remainingDice.length === 0) {
        finishDiceUsage(room, isDoubles);
      }
      io.to(roomId).emit("room-update", state);
    });

    // --- END TURN ---
    socket.on("end-turn", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;

      const player = room.players.find((p: any) => p.socketId === socket.id);
      if (!player || player.color !== state.currentTurn) return;

      advanceTurn(room);
      io.to(roomId).emit("room-update", state);
    });

    // --- AUTO PLAY TURN (timeout helper) ---
    socket.on("auto-play-turn", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) return;
      const state = room.gameState;
      if (state.status !== "playing") return;

      const player = room.players.find((p: any) => p.socketId === socket.id);
      if (!player || player.color !== state.currentTurn) return;

      autoPlayTurn(room, roomId);
    });

    // --- CHECK ROOM ---
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
      const timerKey = `${roomId}:${uid}`;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey)!);
        disconnectTimers.delete(timerKey);
      }
      const dcSet = disconnectedPlayers.get(roomId);
      if (dcSet) dcSet.delete(uid);

      player.socketId = socket.id;
      socket.join(roomId);
      socket.emit("player-assigned", player.color);
      if (room.gameState) {
        socket.emit("room-update", room.gameState);
      } else {
        socket.emit("room-update", createInitialState(room));
      }
    });

    // --- SURRENDER ---
    socket.on("surrender", ({ roomId, uid }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.find((p: any) => p.uid === uid);
      if (!player) return;
      const surrenderedColor = player.color;
      const wasTurn = room.gameState?.currentTurn === surrenderedColor;

      room.players = room.players.filter((p: any) => p.uid !== uid);

      const timerKey = `${roomId}:${uid}`;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey)!);
        disconnectTimers.delete(timerKey);
      }

      const surrenderedPlayerInState = room.gameState?.players.find((p: any) => p.color === surrenderedColor);
      const surrenderedUser = dbService.getUserByUid(uid);
      const surrenderedUsername = surrenderedPlayerInState?.username || surrenderedUser?.username || "Jugador";
      io.to(roomId).emit("player-surrendered", {
        color: surrenderedColor,
        uid,
        username: surrenderedUsername
      });

      if (room.players.length <= 1) {
        if (room.players.length === 1) {
          const winner = room.players[0];
          io.to(roomId).emit("game-won", { winnerColor: winner.color, winnerUid: winner.uid, reason: "surrender" });
        }
        room.status = "finished";
        if (room.gameState) room.gameState.status = "finished";
        io.to(roomId).emit("room-update", room.gameState || createInitialState(room));
        return;
      }

      if (room.gameState) {
        room.gameState.players = room.gameState.players.filter((p: any) => p.color !== surrenderedColor);
        if (wasTurn) advanceTurn(room);
        io.to(roomId).emit("room-update", room.gameState);
      }
    });

    // --- DISCONNECT ---
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      for (const [roomId, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex((p: any) => p.socketId === socket.id);
        if (playerIndex === -1) continue;
        const player = room.players[playerIndex];

        if (room.status === "playing") {
          const timerKey = `${roomId}:${player.uid}`;
          console.log(`Player ${player.uid} disconnected. 30s grace period.`);

          if (!disconnectedPlayers.has(roomId)) {
            disconnectedPlayers.set(roomId, new Set());
          }
          disconnectedPlayers.get(roomId)!.add(player.uid);

          const timer = setTimeout(() => {
            disconnectTimers.delete(timerKey);
            const dcSet = disconnectedPlayers.get(roomId);
            if (dcSet) dcSet.delete(player.uid);

            const currentRoom = rooms.get(roomId);
            if (!currentRoom) return;

            const surrenderedColor = player.color;
            const wasTurn = currentRoom.gameState?.currentTurn === surrenderedColor;

            currentRoom.players = currentRoom.players.filter((p: any) => p.uid !== player.uid);
            const surrenderedPlayerInState = currentRoom.gameState?.players.find((p: any) => p.color === surrenderedColor);
            const surrenderedUser = dbService.getUserByUid(player.uid);
            const surrenderedUsername = surrenderedPlayerInState?.username || surrenderedUser?.username || "Jugador";
            io.to(roomId).emit("player-surrendered", {
              color: surrenderedColor,
              uid: player.uid,
              username: surrenderedUsername
            });

            if (currentRoom.players.length <= 1) {
              if (currentRoom.players.length === 1) {
                const winner = currentRoom.players[0];
                io.to(roomId).emit("game-won", { winnerColor: winner.color, winnerUid: winner.uid, reason: "surrender" });
              }
              currentRoom.status = "finished";
              if (currentRoom.gameState) currentRoom.gameState.status = "finished";
              io.to(roomId).emit("room-update", currentRoom.gameState || createInitialState(currentRoom));
              return;
            }

            if (currentRoom.gameState) {
              currentRoom.gameState.players = currentRoom.gameState.players.filter((p: any) => p.color !== surrenderedColor);
              if (wasTurn) advanceTurn(currentRoom);
              io.to(roomId).emit("room-update", currentRoom.gameState);
            }
          }, 30000);

          disconnectTimers.set(timerKey, timer);
        } else {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            io.to(roomId).emit("room-update", createInitialState(room));
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
    console.log(`Parchís server running on http://localhost:${PORT}`);
  });
}

startServer();
