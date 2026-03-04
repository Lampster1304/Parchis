import React from 'react';
import { motion } from 'motion/react';
import { PlayerColor, Token } from '../types';
import { getSquareCoords, getHomeCoords, getFinalPathCoords, Point } from '../boardLayout';
import { cn } from '../utils';

interface BoardProps {
  tokens: Token[];
  onTokenClick: (token: Token) => void;
  highlightedPositions?: number[];
}

export const ParchisBoard: React.FC<BoardProps> = ({ tokens, onTokenClick, highlightedPositions = [] }) => {
  const GRID_SIZE = 17;

  const getTokensAtPos = (pos: number, tokenColor?: PlayerColor) => {
    return tokens.filter(t => t.position === pos && (pos !== -1 || t.color === tokenColor));
  };

  const getTokenCoords = (token: Token) => {
    let point: Point;
    const tokensAtThisPos = getTokensAtPos(token.position, token.color);
    const tokenIndex = tokensAtThisPos.findIndex(t => t.id === token.id);
    const stackSize = tokensAtThisPos.length;

    if (token.position === -1) {
      point = getHomeCoords(token.color, tokenIndex);
    } else if (token.position > 68) {
      point = getFinalPathCoords(token.color, token.position);
    } else {
      point = getSquareCoords(token.position);
    }

    const stackOffsetsByCount: Record<number, Array<{ x: number; y: number }>> = {
      2: [{ x: -45, y: 0 }, { x: 45, y: 0 }],
      3: [{ x: -60, y: 0 }, { x: 0, y: 0 }, { x: 60, y: 0 }],
      4: [{ x: -70, y: -35 }, { x: 70, y: -35 }, { x: -70, y: 35 }, { x: 70, y: 35 }],
    };
    const isHome = token.position === -1;
    const offset = isHome ? { x: 0, y: 0 } : (stackOffsetsByCount[stackSize]?.[tokenIndex] || { x: 0, y: 0 });
    const scaleByCount: Record<number, number> = { 1: 0.9, 2: 0.6, 3: 0.5, 4: 0.45 };
    const scale = isHome ? 0.9 : (scaleByCount[stackSize] || 0.45);

    return {
      left: `${(point.x / GRID_SIZE) * 100}%`,
      top: `${(point.y / GRID_SIZE) * 100}%`,
      width: `${(1 / GRID_SIZE) * 100}%`,
      height: `${(1 / GRID_SIZE) * 100}%`,
      transform: isHome
        ? `translate(-50%, -50%) scale(${scale})`
        : `translate(${offset.x}%, ${offset.y}%) scale(${scale})`,
      zIndex: 40 + tokenIndex,
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative w-[min(100vw,calc(100dvh-16rem),800px)] aspect-square rounded-xl sm:rounded-2xl p-0 shadow-2xl flex items-center justify-center overflow-hidden bg-black/30"
    >
      <div className="relative w-full h-full rounded shadow-inner border-[1px] border-black/40 overflow-hidden">
        <img
          src="/assets/tablero.png"
          alt="Parchis board"
          className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none"
          draggable={false}
        />

        {/* Tokens Layer */}
        <div className="absolute inset-0 pointer-events-none">
          {tokens.map((token) => (
            <TokenComponent
              key={token.id}
              token={token}
              coords={getTokenCoords(token)}
              onClick={() => onTokenClick(token)}
            />
          ))}
        </div>

        {/* Highlights */}
        {highlightedPositions.map((pos, idx) => {
          const point = pos > 68 ? getFinalPathCoords(tokens[0]?.color || 'red', pos) : getSquareCoords(pos);
          return (
            <div
              key={idx}
              className="absolute bg-white/40 rounded-full border-2 border-white animate-pulse z-30 pointer-events-none shadow-[0_0_15px_white]"
              style={{
                left: `${(point.x / GRID_SIZE) * 100}%`,
                top: `${(point.y / GRID_SIZE) * 100}%`,
                width: `${(1 / GRID_SIZE) * 100}%`,
                height: `${(1 / GRID_SIZE) * 100}%`,
                transform: 'scale(0.8)',
              }}
            />
          );
        })}
      </div>
    </motion.div>
  );
};

const TokenComponent: React.FC<{ token: Token; coords: any; onClick: () => void }> = ({ token, coords, onClick }) => {
  const colorMap = {
    red: 'from-[#FF80AB] via-[#FF4081] to-[#C2185B] border-[#880E4F]',
    yellow: 'from-[#FFF176] via-[#FFEB3B] to-[#FBC02D] border-[#F57F17]',
    green: 'from-[#B9F6CA] via-[#00E676] to-[#388E3C] border-[#1B5E20]',
    blue: 'from-[#82B1FF] via-[#448AFF] to-[#1976D2] border-[#0D47A1]',
  };

  const tokenNumber = (parseInt(token.id.split('-')[1]) % 4) + 1;

  return (
    <motion.div
      layout
      onClick={onClick}
      className="absolute cursor-pointer flex items-center justify-center z-40 pointer-events-auto"
      style={coords}
      initial={false}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      <motion.div
        whileHover={{ scale: 1.2, y: -5 }}
        whileTap={{ scale: 0.9 }}
        className={cn(
          "w-[90%] h-[90%] rounded-full border-[2px] shadow-[0_5px_10px_rgba(0,0,0,0.4)] flex items-center justify-center relative bg-gradient-to-br",
          colorMap[token.color]
        )}
      >
        <div className="absolute top-[15%] left-[15%] w-1/3 h-1/4 bg-white/40 rounded-full blur-[2px]" />
        <span className="relative z-10 text-white font-black text-lg drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]">
          {tokenNumber}
        </span>
      </motion.div>
    </motion.div>
  );
};
