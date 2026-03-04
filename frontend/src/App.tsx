import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { ParchisBoard } from './components/Board';
import { HUD } from './components/HUD';
import { Navbar } from './components/Navbar';
import { GameState, Token, PlayerColor } from './types';
import { cn } from './utils';
import { authService, UserProfile } from './services/authService';
import { AuthView } from './components/AuthView';
import { Trophy, Users, Coins, X, ShoppingBag, MessageSquare, Settings as SettingsIcon, Search, UserPlus, Check, Plus, Key, Flag, RotateCcw } from 'lucide-react';

// --- Modal Component ---
const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string, children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="bg-[#1E293B] border border-white/10 w-full max-w-2xl rounded-[3rem] shadow-2xl relative overflow-hidden flex flex-col max-h-[80vh]"
        >
          <div className="p-8 border-b border-white/5 flex justify-between items-center">
            <h2 className="font-heading text-4xl text-white tracking-widest uppercase">{title}</h2>
            <button onClick={onClose} className="bg-white/5 hover:bg-white/10 p-2 rounded-2xl transition-all pointer-events-auto">
              <X className="w-6 h-6 text-white" />
            </button>
          </div>
          <div className="p-8 overflow-y-auto no-scrollbar flex-1 pointer-events-auto">
            {children}
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

const SESSION_KEY = 'parchis_game_session';

interface GameSession {
  roomCode: string;
  myColor: PlayerColor;
  uid: string;
}

const saveSession = (session: GameSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

const loadSession = (): GameSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

// --- Main App Component ---
export default function App() {
  // Auth & Profile State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Game State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myColor, setMyColor] = useState<PlayerColor | null>(null);

  // UI State
  const [view, setView] = useState<'lobby' | 'waiting-room' | 'game'>('lobby');
  const [activeTab, setActiveTab] = useState('home');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [friendsList, setFriendsList] = useState<UserProfile[]>([]);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [pendingRejoin, setPendingRejoin] = useState<GameSession | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const EXIT_POSITIONS: Record<PlayerColor, number> = {
    red: 5,
    blue: 22,
    yellow: 39,
    green: 56
  };

  // Auth Listener (Shared/Local)
  useEffect(() => {
    const initAuth = async () => {
      const user = authService.getCurrentUser();
      if (user) {
        try {
          // Verify/Refresh user data from server
          const refreshed = await authService.login(user.email);
          // If server's avatar is different from ours, sync it
          if (refreshed.avatar !== user.avatar && user.avatar) {
            console.log("Syncing avatar to server...");
            await authService.updateAvatar(user.uid, user.avatar);
            refreshed.avatar = user.avatar;
          }
          setCurrentUser(refreshed);
          const friends = await authService.getFriendsDetails();
          setFriendsList(friends);
        } catch (e) {
          console.error("Session expired or server down:", e);
          authService.logout();
          setCurrentUser(null);
        }
      }
      setInitialLoading(false);
    };
    initAuth();
  }, []);

  // Socket Connection (Mock/Local Server)
  useEffect(() => {
    if (!currentUser) return;

    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('player-assigned', (color: PlayerColor) => {
      setMyColor(color);
      // Update session with correct color
      const session = loadSession();
      if (session) {
        saveSession({ ...session, myColor: color });
      }
    });

    newSocket.on('room-update', (data: GameState) => {
      setGameState(data);
      // Clear session when game finishes
      if (data.status === 'finished') {
        clearSession();
      }
    });

    newSocket.on('player-surrendered', ({ color }: { color: string }) => {
      showToast(`${color.toUpperCase()} player surrendered!`, 'error');
    });

    newSocket.on('game-won', ({ winnerColor }: { winnerColor: string }) => {
      showToast(`${winnerColor.toUpperCase()} wins the game!`, 'success');
      clearSession();
    });

    newSocket.on('check-room-result', (result: { exists: boolean; canRejoin: boolean; color?: PlayerColor; status?: string }) => {
      if (result.exists && result.canRejoin && result.status === 'playing') {
        const session = loadSession();
        if (session && result.color) {
          setPendingRejoin({ ...session, myColor: result.color });
        }
      } else {
        clearSession();
        setPendingRejoin(null);
      }
    });

    newSocket.on('rejoin-failed', () => {
      clearSession();
      setPendingRejoin(null);
      showToast('Could not rejoin game', 'error');
    });

    return () => {
      newSocket.close();
    };
  }, [currentUser]);

  // Rejoin detection on app load
  useEffect(() => {
    if (!socket || !currentUser) return;
    const session = loadSession();
    if (session && session.uid === currentUser.uid) {
      socket.emit('check-room', { roomId: session.roomCode, uid: session.uid });
    }
  }, [socket, currentUser]);

  // Sync View with Game Status
  useEffect(() => {
    if (gameState?.status === 'playing' && view === 'waiting-room') {
      setView('game');
    }
  }, [gameState?.status, view]);


  // Handlers
  const handleJoinGame = (mode?: string) => {
    if (!currentUser) return;

    // Direct sync when joining to be extra sure
    authService.updateAvatar(currentUser.uid, currentUser.avatar);

    if (mode === 'private') {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      setRoomCode(code);
      setView('waiting-room');
      socket?.emit('join-room', { roomId: code, uid: currentUser.uid });
      saveSession({ roomCode: code, myColor: 'red', uid: currentUser.uid });
      return;
    }
    // Each public mode gets its own room
    const publicRoomId = `public-${mode || 'rookie'}`;
    setRoomCode(publicRoomId);
    socket?.emit('join-room', { roomId: publicRoomId, uid: currentUser.uid });
    saveSession({ roomCode: publicRoomId, myColor: 'red', uid: currentUser.uid });
    setView('game');
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput || !currentUser) return;

    try {
      const code = joinCodeInput.trim().toUpperCase();
      setRoomCode(code);
      setView('waiting-room');
      socket?.emit('join-room', { roomId: code, uid: currentUser.uid });
      saveSession({ roomCode: code, myColor: 'red', uid: currentUser.uid });
      setActiveModal(null);
      setJoinCodeInput('');
      showToast('Entered waiting room!');
    } catch (error: any) {
      showToast(error.message || 'Failed to join', 'error');
    }
  };

  const handleRollDice = (values: [number, number]) => {
    if (!roomCode) return;
    socket?.emit('roll-dice', { roomId: roomCode, values });
  };

  const handleTokenClick = (token: Token) => {
    if (!roomCode) return;
    socket?.emit('move-token', { roomId: roomCode, tokenId: token.id });
  };

  const handleNavChange = (id: string) => {
    if (id === 'home') {
      setActiveModal(null);
      setActiveTab('home');
    } else {
      setActiveModal(id);
      setActiveTab(id);
    }
  };

  const handleLeaveRoom = () => {
    if (roomCode) {
      socket?.emit('leave-room', { roomId: roomCode, uid: currentUser?.uid });
    }
    clearSession();
    setRoomCode(null);
    setGameState(null);
    setMyColor(null);
    setView('lobby');
  };

  const handleLogout = () => {
    handleLeaveRoom();
    clearSession();
    authService.logout();
    setCurrentUser(null);
    setActiveModal(null);
    setActiveTab('home');
  };

  const handleSurrender = () => {
    if (roomCode && currentUser) {
      socket?.emit('surrender', { roomId: roomCode, uid: currentUser.uid });
    }
    clearSession();
    setRoomCode(null);
    setGameState(null);
    setMyColor(null);
    setView('lobby');
    setActiveModal(null);
    setActiveTab('home');
  };

  const handleRejoinGame = () => {
    if (!pendingRejoin || !socket) return;
    socket.emit('rejoin-room', { roomId: pendingRejoin.roomCode, uid: pendingRejoin.uid });
    setRoomCode(pendingRejoin.roomCode);
    setMyColor(pendingRejoin.myColor);
    setView('game');
    setPendingRejoin(null);
  };

  const handleAuthSuccess = async (user: UserProfile) => {
    setCurrentUser(user);
    const friends = await authService.getFriendsDetails();
    setFriendsList(friends);
  };

  const handleSearch = async () => {
    const results = await authService.searchUsers(searchQuery);
    setSearchResults(results);
  };

  const handleSendRequest = async (uid: string) => {
    try {
      await authService.sendFriendRequest(uid);
      showToast('Friend request sent!');
    } catch (error) {
      console.error(error);
      showToast('Failed to send request.', 'error');
    }
  };

  const handleAcceptRequest = async (uid: string) => {
    try {
      await authService.acceptFriendRequest(uid);
      const friends = await authService.getFriendsDetails();
      setFriendsList(friends);
      showToast('Friend request accepted!');
    } catch (error) {
      showToast('Failed to accept request.', 'error');
    }
  };

  const getHighlightedPositions = () => {
    if (!gameState || (!gameState.lastDiceRoll && gameState.bonusSteps === 0)) return [];
    if (gameState.currentTurn !== myColor) return [];

    const roll = gameState.lastDiceRoll;
    const bonus = gameState.bonusSteps;
    const currentPlayer = gameState.players.find(p => p.color === myColor);
    if (!currentPlayer) return [];

    return currentPlayer.tokens.map(token => {
      let moveAmount = 0;
      if (bonus > 0) {
        moveAmount = bonus;
      } else if (roll) {
        const [d1, d2] = roll;
        if (token.position === -1 && (d1 === 5 || d2 === 5 || d1 + d2 === 5)) {
          return EXIT_POSITIONS[token.color];
        }
        moveAmount = d1 + d2;
      }

      if (token.position === -1) return -1;

      let newPos = (token.position + moveAmount) % 68;
      if (token.position < 68 && token.position + moveAmount > 67) {
        return 76;
      }
      return newPos;
    }).filter(pos => pos !== -1);
  };

  // --- Rendering ---

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-[#4A148C] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full"
        />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#4A148C] selection:bg-[#FF3D004D] relative">
        <AuthView onAuthSuccess={handleAuthSuccess} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-hidden selection:bg-[#FF3D004D] relative">
      {/* Background Effect */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ rotate: [40, 45, 40], scale: [1, 1.05, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 flex items-center justify-center opacity-[0.07]"
        >
          <div className="w-[180vmax] h-[180vmax] border-[60px] border-white/10 flex flex-wrap shadow-[inset_0_0_100px_rgba(255,255,255,0.1)]">
            <div className="w-1/2 h-1/2 bg-primary/30 border-r-8 border-b-8 border-white/10" />
            <div className="w-1/2 h-1/2 bg-accent/30 border-b-8 border-white/10" />
            <div className="w-1/2 h-1/2 bg-secondary/30 border-r-8 border-white/10" />
            <div className="w-1/2 h-1/2 bg-emerald-500/30" />
          </div>
        </motion.div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/10 blur-[120px] rounded-full animate-pulse delay-1000" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      <HUD
        view={view}
        onShopClick={() => handleNavChange('shop')}
        onProfileClick={() => handleNavChange('profile')}
        user={currentUser}
        players={gameState?.players || []}
        currentUserId={currentUser?.uid}
        onRoll={handleRollDice}
        lastDiceRoll={gameState?.lastDiceRoll}
        currentTurn={gameState?.currentTurn}
        myColor={myColor}
        onSurrender={handleSurrender}
      />

      <main className="h-screen w-full flex items-center justify-center p-4 overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'lobby' ? (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full h-full flex flex-col items-center justify-center gap-6 px-4 md:px-10 overflow-x-auto no-scrollbar py-20"
            >
              {/* Rejoin Banner */}
              <AnimatePresence>
                {pendingRejoin && (
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="w-full max-w-3xl bg-yellow-500/20 border border-yellow-500/40 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-xl"
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-yellow-500/30 p-3 rounded-2xl">
                        <RotateCcw className="w-6 h-6 text-yellow-500" />
                      </div>
                      <div>
                        <p className="text-yellow-500 font-heading text-xl uppercase tracking-wider">Game in progress</p>
                        <p className="text-yellow-500/60 text-xs font-bold">You were disconnected. Rejoin your match?</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleRejoinGame}
                        className="bg-yellow-500 text-slate-900 font-heading text-lg px-8 py-3 rounded-2xl shadow-xl hover:scale-[1.05] active:scale-95 transition-all uppercase tracking-widest"
                      >
                        REJOIN
                      </button>
                      <button
                        onClick={() => { clearSession(); setPendingRejoin(null); }}
                        className="bg-white/10 text-white/60 font-bold text-sm px-4 py-3 rounded-2xl hover:bg-white/20 transition-all"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="w-full flex flex-row items-center justify-center gap-6">
              {[
                { id: 'rookie', name: 'ROOKIE TABLE', entry: '100', prize: '350', type: 'public' },
                { id: 'pro', name: 'PRO ARENA', entry: '1,000', prize: '3,500', type: 'public' },
                { id: 'private', name: 'PRIVATE MATCH', entry: '0', prize: 'VS FRIENDS', type: 'private' },
                { id: 'legendary', name: 'LEGENDARY', entry: '50,000', prize: '180,000', type: 'public' },
              ].map((mode, idx) => (
                <div key={idx} className="flex-shrink-0 w-full max-w-[320px]">
                  <div className={cn(
                    "bg-black/40 backdrop-blur-2xl flex flex-col justify-between min-h-[400px] p-8 border border-white/10 rounded-[2.5rem] shadow-2xl relative overflow-hidden group hover:border-white/30 transition-all",
                    mode.type === 'private' && "border-yellow-500/30 bg-yellow-500/5"
                  )}>
                    <div>
                      <h3 className="font-heading text-4xl leading-none mb-1 text-white">{mode.name}</h3>
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest opacity-60">
                        <Users className="w-3 h-3" />
                        <span>{mode.type === 'private' ? 'Invite Only' : '4 Players'}</span>
                      </div>
                    </div>
                    <div className="space-y-6 my-8">
                      <div className="flex justify-between items-center bg-white/5 rounded-2xl p-4">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Entry Fee</span>
                        <div className="flex items-center gap-2 text-white">
                          <Coins className="w-4 h-4 text-emerald-400" />
                          <span className="font-heading text-2xl">{mode.entry}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center bg-white/5 rounded-2xl p-4">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Reward</span>
                        <div className="flex items-center gap-2">
                          <Trophy className="w-5 h-5 text-yellow-400" />
                          <span className="font-heading text-3xl text-yellow-400">{mode.prize}</span>
                        </div>
                      </div>
                    </div>
                    {mode.type === 'private' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => handleJoinGame('private')} className="bg-yellow-500 text-slate-900 font-heading text-xl py-4 rounded-3xl shadow-xl hover:scale-[1.05] active:scale-95 transition-all">
                          CREATE
                        </button>
                        <button onClick={() => setActiveModal('join-room')} className="bg-white/10 text-white font-heading text-xl py-4 rounded-3xl border border-white/10 hover:bg-white/20 transition-all">
                          JOIN
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => handleJoinGame(mode.id)} className="bg-white text-slate-900 font-heading text-2xl py-4 rounded-3xl shadow-xl hover:scale-[1.05] active:scale-95 transition-all">
                        JOIN TABLE
                      </button>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </motion.div>
          ) : view === 'waiting-room' ? (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-4xl bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[3rem] p-12 flex flex-col items-center gap-10 shadow-3xl"
            >
              <div className="text-center">
                <span className="text-[10px] text-yellow-500 font-black uppercase tracking-[0.4em] mb-4 block">Waiting Room</span>
                <h2 className="font-heading text-6xl text-white mb-2 leading-none">INVITE FRIENDS</h2>
                <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 mt-8 flex flex-col items-center gap-2 group cursor-pointer hover:bg-white/10 transition-all"
                  onClick={() => {
                    navigator.clipboard.writeText(roomCode || '');
                    showToast('Code copied to clipboard!');
                  }}>
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Room Code</span>
                  <div className="flex items-center gap-4">
                    <span className="font-heading text-6xl text-yellow-500 tracking-[0.2em]">{roomCode}</span>
                    <Key className="w-8 h-8 text-yellow-500/50" />
                  </div>
                </div>
              </div>

              <div className={cn(
                "grid gap-6 w-full max-w-2xl px-4",
                (gameState?.players.length || 0) <= 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"
              )}>
                {(gameState?.players || []).map((player, i) => {
                  const details = {
                    uid: player.id,
                    username: player.username || 'Player',
                    avatar: player.avatar || `https://picsum.photos/seed/${player.id}/100/100`
                  };

                  return (
                    <div key={player.id} className="flex flex-col items-center gap-4">
                      <div className="w-24 h-24 rounded-[2rem] border-4 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)] flex items-center justify-center transition-all overflow-hidden relative">
                        <img
                          src={details.avatar}
                          className="w-full h-full object-cover"
                          alt={details.username}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${details.uid}`;
                          }}
                        />
                        {String(details.uid) === String(currentUser.uid) && (
                          <div className="absolute top-0 right-0 bg-emerald-500 text-[8px] font-black px-2 py-1 uppercase rounded-bl-xl text-white">YOU</div>
                        )}
                        {player.color && (
                          <div className={cn("absolute bottom-0 inset-x-0 h-1", {
                            "bg-red-500": player.color === 'red',
                            "bg-blue-500": player.color === 'blue',
                            "bg-yellow-500": player.color === 'yellow',
                            "bg-green-500": player.color === 'green',
                          })} />
                        )}
                      </div>
                      <span className="font-bold text-xs uppercase tracking-widest text-center max-w-[120px] truncate text-white">
                        {details.username}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="w-full max-w-md space-y-4">
                <button
                  disabled={!roomCode || (gameState?.players.length || 0) < 2 || gameState?.players[0]?.id !== currentUser?.uid}
                  onClick={() => {
                    if (roomCode) {
                      socket?.emit('start-match', roomCode);
                    }
                  }}
                  className="w-full bg-white text-slate-900 font-heading text-2xl py-6 rounded-[2rem] shadow-2xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-20 disabled:cursor-not-allowed uppercase tracking-widest"
                >
                  {(gameState?.players.length || 0) < 2 ? 'WAITING FOR PLAYERS...' : 'Start Match'}
                </button>
                <button onClick={handleLeaveRoom} className="w-full text-white/30 font-bold text-sm hover:text-white transition-all uppercase tracking-widest">
                  Leave Room
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="game"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center w-full h-full relative"
            >
              <div className="relative flex items-center justify-center max-w-full max-h-full">
                <ParchisBoard
                  tokens={gameState?.players.flatMap(p => p.tokens) || []}
                  onTokenClick={handleTokenClick}
                  highlightedPositions={getHighlightedPositions()}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <Navbar active={activeTab} onChange={handleNavChange} />

      {/* Modals */}
      <Modal isOpen={activeModal === 'profile'} onClose={() => { setActiveModal(null); setActiveTab('home'); }} title="User Profile">
        <div className="flex flex-col items-center gap-8 py-4">
          <div className="relative group">
            <div className="w-32 h-32 rounded-[2.5rem] overflow-hidden border-4 border-white/20 shadow-2xl transition-transform group-hover:scale-105">
              <img src={currentUser?.avatar} alt="avatar" className="w-full h-full object-cover" />
            </div>
            <div className="absolute -bottom-2 -right-2 bg-emerald-500 p-2 rounded-2xl shadow-lg border-4 border-[#1E293B]">
              <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
            </div>
          </div>

          <div className="text-center">
            <h3 className="font-heading text-5xl text-white mb-1 tracking-wider uppercase">{currentUser?.username}</h3>
            <p className="text-white/40 font-bold text-sm tracking-widest">{currentUser?.email}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 w-full">
            <div className="bg-white/5 border border-white/5 p-6 rounded-[2rem] flex flex-col items-center gap-2">
              <span className="text-[10px] text-white/30 font-black uppercase tracking-widest">Balance</span>
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-yellow-500" />
                <span className="font-heading text-3xl text-white">{currentUser?.coins.toLocaleString()}</span>
              </div>
            </div>
            <div className="bg-white/5 border border-white/5 p-6 rounded-[2rem] flex flex-col items-center gap-2">
              <span className="text-[10px] text-white/30 font-black uppercase tracking-widest">Global Rank</span>
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                <span className="font-heading text-3xl text-white">#1,240</span>
              </div>
            </div>
          </div>

          <div className="w-full space-y-3">
            <div className="flex justify-between items-center bg-white/5 p-5 rounded-2xl border border-white/5">
              <span className="text-white/60 font-bold text-sm">Member Since</span>
              <span className="text-white font-bold text-sm tracking-tight">{new Date(currentUser?.createdAt || '').toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between items-center bg-white/5 p-5 rounded-2xl border border-white/5">
              <span className="text-white/60 font-bold text-sm">Games Played</span>
              <span className="text-white font-bold text-sm">42</span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full py-4 rounded-2xl bg-white/5 border border-white/5 text-red-400 font-bold hover:bg-red-400/10 hover:border-red-400/20 transition-all uppercase tracking-widest text-[10px] mt-4"
          >
            Switch Account / Log Out
          </button>
        </div>
      </Modal>

      <Modal isOpen={activeModal === 'shop'} onClose={() => { setActiveModal(null); setActiveTab('home'); }} title="Store">
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white/5 rounded-3xl p-6 border border-white/5 flex flex-col items-center gap-4 hover:bg-white/10 transition-all cursor-pointer">
              <ShoppingBag className="w-12 h-12 text-blue-400" />
              <span className="font-black text-white">SKIN PACK {i}</span>
              <button className="bg-green-500 text-white px-6 py-2 rounded-full font-bold">$1.99</button>
            </div>
          ))}
        </div>
      </Modal>

      <Modal isOpen={activeModal === 'rank'} onClose={() => { setActiveModal(null); setActiveTab('home'); }} title="Rankings">
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex justify-between items-center bg-white/5 rounded-2xl p-4 border border-white/5">
              <div className="flex items-center gap-4">
                <span className="font-black text-slate-500 text-2xl w-8">#{i}</span>
                <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden">
                  <img src={`https://picsum.photos/seed/${i}/100/100`} alt="user" />
                </div>
                <span className="font-bold text-white">Player_{i}99</span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                <span className="font-heading text-xl text-yellow-500">{1000 - i * 10}</span>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <Modal isOpen={activeModal === 'social'} onClose={() => { setActiveModal(null); setActiveTab('home'); }} title="Social Hub">
        <div className="space-y-8">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-white/30 transition-all"
            />
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] text-emerald-400 font-black uppercase tracking-[0.2em] mb-4">Results</h4>
              {searchResults.map(user => (
                <div key={user.uid} className="flex justify-between items-center bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/10">
                  <div className="flex items-center gap-3">
                    <img src={user.avatar} className="w-10 h-10 rounded-xl" alt="" />
                    <span className="text-white font-bold">{user.username}</span>
                  </div>
                  <button onClick={() => handleSendRequest(user.uid)} className="bg-emerald-500 p-2 rounded-xl text-white">
                    <UserPlus className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Requests */}
          {currentUser && (
            <PendingRequests
              currentUser={currentUser}
              onAccept={handleAcceptRequest}
            />
          )}

          {/* Friends List */}
          <div className="space-y-3">
            <h4 className="text-[10px] text-white/30 font-black uppercase tracking-[0.2em] mb-4">Your Friends</h4>
            {friendsList.length === 0 ? (
              <div className="text-center py-10 opacity-30 text-white italic text-sm">No friends added yet. Start searching!</div>
            ) : (
              friendsList.map(friend => (
                <div key={friend.uid} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5 group hover:bg-white/10 transition-all">
                  <div className="flex items-center gap-3">
                    <img src={friend.avatar} className="w-10 h-10 rounded-xl" alt="" />
                    <span className="text-white font-bold">{friend.username}</span>
                  </div>
                  <button className="bg-white/10 p-2 rounded-xl text-white opacity-0 group-hover:opacity-100 transition-all">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={activeModal === 'join-room'} onClose={() => { setActiveModal(null); setActiveTab('home'); }} title="Join Private Match">
        <form onSubmit={handleJoinByCode} className="flex flex-col items-center gap-6 py-4">
          <div className="bg-yellow-500/20 p-4 rounded-full mb-2">
            <Key className="w-8 h-8 text-yellow-500" />
          </div>
          <div className="text-center">
            <p className="text-white font-bold">Enter the 6-digit room code</p>
            <p className="text-white/40 text-xs">Ask your friend for the code to join their game</p>
          </div>
          <input
            type="text"
            placeholder="CODE"
            maxLength={6}
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
            className="w-full max-w-xs bg-white/5 border border-white/10 rounded-2xl py-6 text-center text-4xl font-heading tracking-[0.5em] text-white focus:outline-none focus:border-yellow-500/50 transition-all uppercase"
          />
          <button type="submit" className="w-full max-w-xs bg-yellow-500 text-slate-900 font-heading text-2xl py-4 rounded-3xl shadow-xl hover:scale-[1.05] active:scale-95 transition-all uppercase tracking-widest">
            ENTER ARENA
          </button>
        </form>
      </Modal>

      <Modal isOpen={activeModal === 'settings'} onClose={() => { setActiveModal(null); setActiveTab('home'); }} title="Settings">
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl text-white">
            <span className="font-bold">Sound Effects</span>
            <div className="w-12 h-6 bg-green-500 rounded-full relative"><div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" /></div>
          </div>
          <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl text-white">
            <span className="font-bold">Music</span>
            <div className="w-12 h-6 bg-slate-600 rounded-full relative"><div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full" /></div>
          </div>
          {gameState?.status === 'playing' ? (
            <button onClick={handleSurrender} className="w-full bg-red-500/20 text-red-500 font-bold py-4 rounded-2xl border border-red-500/20 hover:bg-red-500/30 transition-all flex items-center justify-center gap-2">
              <Flag className="w-4 h-4" /> SURRENDER
            </button>
          ) : (
            <button onClick={() => { handleLeaveRoom(); setActiveModal(null); setActiveTab('home'); }} className="w-full bg-red-500/20 text-red-500 font-bold py-4 rounded-2xl border border-red-500/20 hover:bg-red-500/30 transition-all">EXIT TO LOBBY</button>
          )}
          <button onClick={handleLogout} className="w-full bg-slate-800 text-slate-400 font-bold py-4 rounded-2xl border border-white/5 hover:bg-slate-700 hover:text-white transition-all">LOG OUT</button>
        </div>
      </Modal>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] pointer-events-none"
          >
            <div className={cn(
              "px-6 py-3 rounded-2xl shadow-2xl border backdrop-blur-md flex items-center gap-3",
              toast.type === 'success' ? "bg-emerald-500/90 border-emerald-400/20 text-white" : "bg-red-500/90 border-red-400/20 text-white"
            )}>
              {toast.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
              <span className="font-bold text-sm tracking-wide">{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Helper Components ---

const PendingRequests: React.FC<{
  currentUser: UserProfile;
  onAccept: (uid: string) => Promise<void>;
}> = ({ currentUser, onAccept }) => {
  const [requests, setRequests] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await authService.getFriendRequests();
      setRequests(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentUser]);

  if (loading) return <div className="animate-pulse h-20 bg-white/5 rounded-2xl" />;
  if (requests.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-[10px] text-yellow-500 font-black uppercase tracking-[0.2em] mb-4">Requests Pending</h4>
      {requests.map(user => (
        <div key={user.uid} className="flex justify-between items-center bg-yellow-500/5 p-4 rounded-2xl border border-yellow-500/10">
          <div className="flex items-center gap-3">
            <img src={user.avatar} className="w-10 h-10 rounded-xl" alt="" />
            <span className="text-white font-bold">{user.username}</span>
          </div>
          <button
            onClick={async () => {
              await onAccept(user.uid);
              load(); // Refresh list
            }}
            className="bg-yellow-500 p-2 rounded-xl text-slate-900"
          >
            <Check className="w-5 h-5" />
          </button>
        </div>
      ))}
    </div>
  );
};
