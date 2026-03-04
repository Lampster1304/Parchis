import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Coins, ShoppingCart, Flag } from 'lucide-react';
import { cn } from '../utils';

interface HUDPlayer {
  id: string;
  username: string;
  avatar: string;
  color: string;
  isTurn: boolean;
}

export const HUD: React.FC<{
  view?: 'lobby' | 'game' | 'waiting-room';
  onShopClick?: () => void;
  onProfileClick?: () => void;
  user?: any;
  players?: HUDPlayer[];
  currentUserId?: string;
  onRoll?: (values: [number, number]) => void;
  lastDiceRoll?: [number, number] | null;
  remainingDice?: number[];
  currentTurn?: string | null;
  myColor?: string | null;
  onSurrender?: () => void;
  onPassDie?: (dieValue: number) => void;
  turnProgress?: number;
  turnSecondsLeft?: number;
}> = ({ view = 'game', onShopClick, onProfileClick, user, players = [], currentUserId, onRoll, lastDiceRoll, remainingDice = [], currentTurn, myColor, onSurrender, onPassDie, turnProgress = 1, turnSecondsLeft = 0 }) => {

  const currentPlayer = players.find(p => String(p.id) === String(currentUserId));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 p-4 md:p-6 flex flex-col justify-between">
      {/* Top Bar */}
      <div className="flex justify-between items-start w-full">
        {view === 'lobby' && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onProfileClick}
            className="pointer-events-auto bg-black/30 backdrop-blur-md rounded-[2rem] p-1.5 border border-white/10 cursor-pointer hover:bg-black/40 transition-all group"
          >
            <div className="w-14 h-14 rounded-[1.6rem] overflow-hidden border-2 border-white/20">
              <img src={user?.avatar || "https://picsum.photos/seed/me/100/100"} alt="profile" className="w-full h-full object-cover" />
            </div>
          </motion.button>
        )}

        {view !== 'lobby' && <div />}

        {/* Top Right: Surrender + Currency */}
        <div className="flex gap-2 items-center">
          {view === 'game' && onSurrender && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onSurrender}
              className="pointer-events-auto bg-red-500/20 backdrop-blur-md rounded-full p-2.5 border border-red-500/30 hover:bg-red-500/30 transition-all"
              title="Surrender"
            >
              <Flag className="w-5 h-5 text-red-400" />
            </motion.button>
          )}
          <div
            onClick={onShopClick}
            className="flex gap-2 pointer-events-auto items-center bg-black/30 backdrop-blur-md rounded-full pl-2 pr-1 py-1 border border-white/20 cursor-pointer hover:bg-black/40 transition-all group"
          >
            <div className="bg-yellow-500 rounded-full p-1.5 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Coins className="w-5 h-5 text-slate-900" />
            </div>
            <span className="font-bold text-white px-2 tracking-tight">{user?.coins?.toLocaleString() || '0'}</span>
            <div className="bg-white/10 rounded-full p-2 group-hover:bg-white/20 transition-all">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop player cards removed - now using GamePlayerRow in App.tsx for all sizes */}
    </div>
  );
};

// --- Player + Dice combined component ---
const PlayerWithDice: React.FC<{
  name: string;
  image: string;
  color: string;
  isTurn: boolean;
  isMyDice: boolean;
  canRoll: boolean;
  diceValues: [number, number] | null | undefined;
  remainingDice: number[];
  onRoll?: (values: [number, number]) => void;
  onPassDie?: (dieValue: number) => void;
  diceAlign: 'left' | 'right';
  onAvatarClick?: () => void;
  timerProgress?: number;
  timerSecondsLeft?: number;
}> = ({ name, image, color, isTurn, isMyDice, canRoll, diceValues, remainingDice, onRoll, onPassDie, diceAlign, onAvatarClick, timerProgress = 1, timerSecondsLeft }) => {
  return (
    <div className={cn(
      "flex items-center gap-1.5 sm:gap-3",
      diceAlign === 'right' && "flex-row-reverse"
      )}>
      {/* Avatar */}
      <div onClick={onAvatarClick} className={cn("cursor-pointer", onAvatarClick && "hover:scale-105 active:scale-95 transition-transform")}>
        <Avatar
          name={name}
          image={image}
          active={isTurn}
          color={color}
          turnProgress={timerProgress}
          turnSecondsLeft={timerSecondsLeft}
        />
      </div>
      {/* Dice */}
      <MiniDice
        values={diceValues || [1, 1]}
        isTurn={isTurn}
        canRoll={isMyDice && canRoll}
        remainingDice={remainingDice}
        onRoll={onRoll}
        onPassDie={isMyDice ? onPassDie : undefined}
      />
    </div>
  );
};

// --- Mini Dice (smaller, per-player) ---
const MiniDice: React.FC<{
  values: [number, number];
  isTurn: boolean;
  canRoll: boolean;
  remainingDice: number[];
  onRoll?: (values: [number, number]) => void;
  onPassDie?: (dieValue: number) => void;
}> = ({ values, isTurn, canRoll, remainingDice, onRoll, onPassDie }) => {
  const [rolling, setRolling] = useState(false);
  const [displayValues, setDisplayValues] = useState<[number, number]>(values);

  React.useEffect(() => {
    if (!rolling) {
      setDisplayValues(values);
    }
  }, [values, rolling]);

  const rollDice = () => {
    if (!canRoll || rolling || !onRoll) return;
    setRolling(true);

    if ('vibrate' in navigator) {
      navigator.vibrate([10, 30, 10, 30]);
    }

    let iterations = 0;
    const interval = setInterval(() => {
      setDisplayValues([
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1
      ]);
      iterations++;
      if (iterations > 10) {
        clearInterval(interval);
        const finalValues: [number, number] = [
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1
        ];
        setDisplayValues(finalValues);
        setRolling(false);
        onRoll(finalValues);
      }
    }, 50);
  };

  const disabled = !canRoll;

  return (
    <div className={cn(
      "flex gap-1 sm:gap-1.5 p-1 sm:p-1.5 rounded-lg sm:rounded-xl backdrop-blur-sm border transition-all",
      isTurn
        ? "bg-black/30 border-yellow-500/40 shadow-[0_0_15px_rgba(234,179,8,0.2)]"
        : "bg-black/20 border-white/5 opacity-40 scale-90"
    )}>
      {[0, 1].map((idx) => {
        const dieVal = displayValues[idx];
        const isUsed = isTurn && remainingDice.length > 0 && !remainingDice.includes(values[idx]);
        // Check if this specific die index is used (handle doubles correctly)
        const usedCount = values.filter(v => !remainingDice.includes(v)).length;
        const isDieUsed = isTurn && remainingDice.length > 0 && remainingDice.length < 2 &&
          (remainingDice[0] !== values[idx] || (idx === 1 && remainingDice.length === 1 && remainingDice[0] === values[0]));

        return (
          <motion.div
            key={idx}
            whileHover={!disabled ? { scale: 1.1 } : {}}
            whileTap={!disabled ? { scale: 0.85 } : {}}
            onClick={rollDice}
            className={cn(
              "w-7 h-7 sm:w-10 sm:h-10 rounded-md sm:rounded-lg bg-white flex items-center justify-center shadow-md relative overflow-hidden",
              disabled && "cursor-default",
              !disabled && "cursor-pointer",
              rolling && "animate-bounce",
              isUsed && "opacity-30 scale-90"
            )}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-300" />
            <div className="absolute inset-[1px] border border-white/50 rounded-[7px]" />
            <div className="relative grid grid-cols-3 grid-rows-3 gap-[1px] p-1.5 w-full h-full">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
                const show = shouldShowDot(dieVal, i);
                return (
                  <div key={i} className="flex items-center justify-center">
                    {show && <div className="w-1.5 h-1.5 bg-slate-700 rounded-full shadow-inner" />}
                  </div>
                );
              })}
            </div>
            {isUsed && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-white text-xs font-black">✓</span>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
};

function shouldShowDot(value: number, index: number) {
  const dots: Record<number, number[]> = {
    1: [5],
    2: [3, 7],
    3: [3, 5, 7],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  return dots[value]?.includes(index);
}

// --- Color mappings ---
const COLOR_RING: Record<string, string> = {
  red: 'shadow-[0_0_15px_rgba(239,68,68,0.45)]',
  blue: 'shadow-[0_0_15px_rgba(59,130,246,0.45)]',
  yellow: 'shadow-[0_0_15px_rgba(234,179,8,0.45)]',
  green: 'shadow-[0_0_15px_rgba(34,197,94,0.45)]',
};

const COLOR_HEX: Record<string, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  yellow: '#facc15',
  green: '#22c55e',
};

const COLOR_DOT: Record<string, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
};

const COLOR_LABEL: Record<string, string> = {
  red: 'bg-red-500/80',
  blue: 'bg-blue-500/80',
  yellow: 'bg-yellow-500/80',
  green: 'bg-green-500/80',
};

// --- Avatar ---
const Avatar: React.FC<{
  name: string;
  image: string;
  active?: boolean;
  color?: string;
  turnProgress?: number;
  turnSecondsLeft?: number;
}> = ({ name, image, active, color, turnProgress = 1, turnSecondsLeft }) => {
  const progress = Math.max(0, Math.min(1, turnProgress));
  const progressDeg = progress * 360;
  const ringColor = color ? COLOR_HEX[color] : '#ffffff';

  return (
    <div className="flex flex-col items-center gap-0.5 sm:gap-2">
      <div
        className={cn(
          "w-10 h-10 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full p-[2px] sm:p-[3px] relative transition-transform",
          color ? COLOR_RING[color] : "shadow-[0_0_10px_rgba(255,255,255,0.2)]",
          active && "scale-110"
        )}
        style={{ background: `conic-gradient(${ringColor} ${progressDeg}deg, rgba(255,255,255,0.16) ${progressDeg}deg 360deg)` }}
      >
        <div className="w-full h-full rounded-full border-2 border-white/30 overflow-hidden shadow-inner bg-slate-800">
          <img src={image} alt={name} className="w-full h-full object-cover" />
        </div>
        {color && (
          <div className={cn("absolute -bottom-0.5 sm:-bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 sm:w-4 sm:h-4 rounded-full border-2 border-white", COLOR_DOT[color])} />
        )}
        {active && (
          <div className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 min-w-4 h-4 sm:min-w-5 sm:h-5 px-0.5 sm:px-1 bg-yellow-400 rounded-full border-2 border-white flex items-center justify-center animate-pulse">
            <span className="text-[6px] sm:text-[8px] font-black text-slate-900">{turnSecondsLeft ?? 0}</span>
          </div>
        )}
      </div>
      <span className={cn(
        "text-white font-bold text-[8px] sm:text-xs drop-shadow-md px-1.5 sm:px-2 py-0.5 rounded-full",
        color ? COLOR_LABEL[color] : "bg-black/20"
      )}>{name}</span>
    </div>
  );
};

// --- Exported row of players for mobile game layout (above/below board) ---
export const GamePlayerRow: React.FC<{
  players: { id: string; username: string; avatar: string; color: string; isTurn: boolean }[];
  colors: string[];
  currentUserId?: string;
  user?: any;
  currentTurn?: string | null;
  myColor?: string | null;
  lastDiceRoll?: [number, number] | null;
  remainingDice?: number[];
  onRoll?: (values: [number, number]) => void;
  onPassDie?: (dieValue: number) => void;
  onProfileClick?: () => void;
  turnProgress?: number;
  turnSecondsLeft?: number;
}> = ({ players, colors, currentUserId, user, currentTurn, myColor, lastDiceRoll, remainingDice = [], onRoll, onPassDie, onProfileClick, turnProgress = 1, turnSecondsLeft = 0 }) => {
  const rowPlayers = colors
    .map(c => players.find(p => p.color === c))
    .filter(Boolean) as typeof players;
  if (rowPlayers.length === 0) return null;

  return (
    <div className="flex w-full">
      {rowPlayers.map((player) => {
        const isMe = String(player.id) === String(currentUserId);
        const isLeft = player.color === colors[0];
        return (
          <div key={player.id} className={cn("w-1/2 flex pointer-events-auto", isLeft ? "justify-start pl-1" : "justify-end pr-1")}>
            <PlayerWithDice
              name={isMe ? (user?.username || "You") : (player.username || "Player")}
              image={isMe ? (user?.avatar || `https://picsum.photos/seed/${player.id}/100/100`) : (player.avatar || `https://picsum.photos/seed/${player.id}/100/100`)}
              color={player.color}
              isTurn={player.isTurn}
              isMyDice={isMe}
              canRoll={isMe && currentTurn === myColor && remainingDice.length === 0 && !lastDiceRoll}
              diceValues={player.isTurn ? lastDiceRoll : null}
              remainingDice={player.isTurn ? remainingDice : []}
              onRoll={isMe ? onRoll : undefined}
              onPassDie={isMe ? onPassDie : undefined}
              diceAlign={isLeft ? "left" : "right"}
              onAvatarClick={isMe ? onProfileClick : undefined}
              timerProgress={player.isTurn ? turnProgress : 1}
              timerSecondsLeft={player.isTurn ? turnSecondsLeft : undefined}
            />
          </div>
        );
      })}
    </div>
  );
};
