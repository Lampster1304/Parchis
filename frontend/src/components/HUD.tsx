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
  currentTurn?: string | null;
  myColor?: string | null;
  onSurrender?: () => void;
}> = ({ view = 'game', onShopClick, onProfileClick, user, players = [], currentUserId, onRoll, lastDiceRoll, currentTurn, myColor, onSurrender }) => {

  const otherPlayers = players.filter(p => String(p.id) !== String(currentUserId));
  const currentPlayer = players.find(p => String(p.id) === String(currentUserId));

  const otherPositions = [
    { className: "absolute top-24 right-4 md:right-10", diceAlign: "right" as const },
    { className: "absolute bottom-32 left-4 md:left-10", diceAlign: "left" as const },
    { className: "absolute bottom-32 right-4 md:right-10", diceAlign: "right" as const },
  ];

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

      {/* Avatars + Dice in corners - Only in Game View */}
      {view === 'game' && players.length > 0 && (
        <div className="absolute inset-0 pointer-events-none p-4 md:p-10">
          {/* Current Player - Top Left */}
          <div className="absolute top-24 left-4 md:left-10 pointer-events-auto">
            <PlayerWithDice
              name={user?.username || "You"}
              image={user?.avatar || "https://picsum.photos/seed/me/100/100"}
              color={currentPlayer?.color || 'red'}
              isTurn={currentPlayer?.isTurn || false}
              isMyDice={true}
              canRoll={currentTurn === myColor}
              diceValues={currentPlayer?.isTurn ? lastDiceRoll : null}
              onRoll={onRoll}
              diceAlign="left"
              onAvatarClick={onProfileClick}
            />
          </div>
          {/* Other Players */}
          {otherPlayers.map((player, idx) => {
            if (idx >= otherPositions.length) return null;
            return (
              <div key={player.id} className={cn(otherPositions[idx].className, "pointer-events-auto")}>
                <PlayerWithDice
                  name={player.username || "Player"}
                  image={player.avatar || `https://picsum.photos/seed/${player.id}/100/100`}
                  color={player.color}
                  isTurn={player.isTurn}
                  isMyDice={false}
                  canRoll={false}
                  diceValues={player.isTurn ? lastDiceRoll : null}
                  diceAlign={otherPositions[idx].diceAlign}
                />
              </div>
            );
          })}
        </div>
      )}
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
  onRoll?: (values: [number, number]) => void;
  diceAlign: 'left' | 'right';
  onAvatarClick?: () => void;
}> = ({ name, image, color, isTurn, isMyDice, canRoll, diceValues, onRoll, diceAlign, onAvatarClick }) => {
  return (
    <div className={cn(
      "flex items-center gap-3",
      diceAlign === 'right' && "flex-row-reverse"
    )}>
      {/* Avatar */}
      <div onClick={onAvatarClick} className={cn("cursor-pointer", onAvatarClick && "hover:scale-105 active:scale-95 transition-transform")}>
        <Avatar name={name} image={image} active={isTurn} color={color} />
      </div>
      {/* Dice */}
      <MiniDice
        values={diceValues || [1, 1]}
        isTurn={isTurn}
        canRoll={isMyDice && canRoll}
        onRoll={onRoll}
      />
    </div>
  );
};

// --- Mini Dice (smaller, per-player) ---
const MiniDice: React.FC<{
  values: [number, number];
  isTurn: boolean;
  canRoll: boolean;
  onRoll?: (values: [number, number]) => void;
}> = ({ values, isTurn, canRoll, onRoll }) => {
  const [rolling, setRolling] = useState(false);
  const [displayValues, setDisplayValues] = useState<[number, number]>(values);

  // Sync display values when props change (other player rolled)
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
      "flex gap-1.5 p-1.5 rounded-xl backdrop-blur-sm border transition-all",
      isTurn
        ? "bg-black/30 border-yellow-500/40 shadow-[0_0_15px_rgba(234,179,8,0.2)]"
        : "bg-black/20 border-white/5 opacity-40 scale-90"
    )}>
      {[0, 1].map((idx) => (
        <motion.div
          key={idx}
          whileHover={!disabled ? { scale: 1.1 } : {}}
          whileTap={!disabled ? { scale: 0.85 } : {}}
          onClick={rollDice}
          className={cn(
            "w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-md relative overflow-hidden",
            disabled && "cursor-default",
            !disabled && "cursor-pointer",
            rolling && "animate-bounce"
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-300" />
          <div className="absolute inset-[1px] border border-white/50 rounded-[7px]" />
          <div className="relative grid grid-cols-3 grid-rows-3 gap-[1px] p-1.5 w-full h-full">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
              const show = shouldShowDot(displayValues[idx], i);
              return (
                <div key={i} className="flex items-center justify-center">
                  {show && <div className="w-1.5 h-1.5 bg-slate-700 rounded-full shadow-inner" />}
                </div>
              );
            })}
          </div>
        </motion.div>
      ))}
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
  red: 'ring-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]',
  blue: 'ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]',
  yellow: 'ring-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.4)]',
  green: 'ring-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]',
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
const Avatar: React.FC<{ name: string; image: string; active?: boolean; color?: string }> = ({ name, image, active, color }) => (
  <div className="flex flex-col items-center gap-2">
    <div className={cn(
      "w-16 h-16 md:w-20 md:h-20 rounded-full p-1 relative ring-3",
      color ? COLOR_RING[color] : "ring-white/20",
      active && "scale-110"
    )}>
      <div className="w-full h-full rounded-full border-2 border-white/30 overflow-hidden shadow-inner bg-slate-800">
        <img src={image} alt={name} className="w-full h-full object-cover" />
      </div>
      {/* Color dot indicator */}
      {color && (
        <div className={cn("absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white", COLOR_DOT[color])} />
      )}
      {/* Turn indicator */}
      {active && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full border-2 border-white flex items-center justify-center animate-pulse">
          <span className="text-[8px] font-black text-slate-900">!</span>
        </div>
      )}
    </div>
    <span className={cn(
      "text-white font-bold text-xs drop-shadow-md px-2 py-0.5 rounded-full",
      color ? COLOR_LABEL[color] : "bg-black/20"
    )}>{name}</span>
  </div>
);
