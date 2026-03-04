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

const COLORS = {
  red: '#FF4D6D',
  yellow: '#FFEA00',
  green: '#00E676',
  blue: '#2979FF',
  white: '#FFFFFF',
  black: '#000000',
  border: '#333333'
};

export const ParchisBoard: React.FC<BoardProps> = ({ tokens, onTokenClick, highlightedPositions = [] }) => {
  const GRID_SIZE = 17;

  const getTokensAtPos = (pos: number, tokenColor?: PlayerColor) => {
    return tokens.filter(t => t.position === pos && (pos !== -1 || t.color === tokenColor));
  };

  const getTokenCoords = (token: Token) => {
    let point: Point;
    const tokensAtThisPos = getTokensAtPos(token.position, token.color);
    const tokenIndex = tokensAtThisPos.findIndex(t => t.id === token.id);
    const isBlockade = tokensAtThisPos.length > 1;

    if (token.position === -1) {
      point = getHomeCoords(token.color, tokenIndex);
    } else if (token.position >= 68) {
      point = getFinalPathCoords(token.color, token.position);
    } else {
      point = getSquareCoords(token.position);
    }

    const offsetX = isBlockade ? (tokenIndex === 0 ? -25 : 25) : 0;
    const scale = isBlockade ? 0.75 : 0.9;

    return {
      left: `${(point.x / GRID_SIZE) * 100}%`,
      top: `${(point.y / GRID_SIZE) * 100}%`,
      width: `${(1 / GRID_SIZE) * 100}%`,
      height: `${(1 / GRID_SIZE) * 100}%`,
      transform: `translate(${offsetX}%, 0) scale(${scale})`,
      zIndex: 40 + tokenIndex,
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative w-[min(95vw,95vh,800px)] aspect-square bg-[#BBBBBB] rounded-2xl p-2 md:p-6 shadow-2xl flex items-center justify-center overflow-hidden"
    >
      <div className="relative w-full h-full bg-white rounded shadow-inner border-[1px] border-black/30 grid grid-cols-17 grid-rows-17 overflow-hidden">

        {/* Home Areas (7x7) */}
        <HomeArea color="red" className="col-start-1 col-end-8 row-start-1 row-end-8" />
        <HomeArea color="yellow" className="col-start-11 col-end-18 row-start-1 row-end-8" />
        <HomeArea color="green" className="col-start-1 col-end-8 row-start-11 row-end-18" />
        <HomeArea color="blue" className="col-start-11 col-end-18 row-start-11 row-end-18" />

        {/* Path Rendering */}
        <div className="absolute inset-0 grid grid-cols-17 grid-rows-17 pointer-events-none">
          {Array.from({ length: 68 }).map((_, i) => {
            const pos = i + 1;
            const point = getSquareCoords(pos);

            // Refined safe squares for 17x17 shifted mapping (Red Salida = 1)
            const safeSquares = [1, 8, 13, 18, 25, 30, 35, 42, 47, 52, 59, 64, 68];
            const exits = [1, 18, 35, 52];
            const isSafe = safeSquares.includes(pos);
            const isExit = exits.includes(pos);

            const colorMap = {
              1: COLORS.red,
              18: COLORS.yellow,
              35: COLORS.blue,
              52: COLORS.green
            };

            return (
              <div
                key={pos}
                className={cn(
                  "border-[0.5px] border-black/10 flex items-center justify-center relative bg-white",
                  isExit ? "" : "" // Logic in style for precision
                )}
                style={{
                  gridColumnStart: point.x + 1,
                  gridRowStart: point.y + 1,
                  backgroundColor: isExit ? colorMap[pos as keyof typeof colorMap] : '#FFFFFF'
                }}
              >
                {/* Safe Square Circle (Matches imagenes/parchis.jpg) */}
                {isSafe && (
                  <div className="w-2/3 h-2/3 rounded-full border-[1px] border-black/20 bg-white/90 shadow-sm" />
                )}
                {/* Optional subtle position number */}
                {/* <span className="text-[8px] absolute bottom-0 right-0 text-gray-200">{pos}</span> */}
              </div>
            );
          })}

          {/* Goal Lanes */}
          {['red', 'yellow', 'blue', 'green'].map((color) =>
            Array.from({ length: 8 }).map((_, i) => {
              const pos = 69 + i;
              const point = getFinalPathCoords(color as PlayerColor, pos);
              const colorMap = { red: COLORS.red, yellow: COLORS.yellow, green: COLORS.green, blue: COLORS.blue };
              return (
                <div
                  key={`${color}-${i}`}
                  className="border-[0.5px] border-black/10"
                  style={{
                    gridColumnStart: point.x + 1,
                    gridRowStart: point.y + 1,
                    backgroundColor: colorMap[color as PlayerColor]
                  }}
                />
              );
            })
          )}
        </div>

        {/* Goal Area (3x3 Center) */}
        <div className="col-start-8 col-end-11 row-start-8 row-end-11 relative overflow-hidden bg-white border-[0.5px] border-black/10">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <polygon points="50,50 0,0 100,0" fill={COLORS.yellow} />
            <polygon points="50,50 100,0 100,100" fill={COLORS.blue} />
            <polygon points="50,50 100,100 0,100" fill={COLORS.green} />
            <polygon points="50,50 0,100 0,0" fill={COLORS.red} />
            <line x1="0" y1="0" x2="100" y2="100" stroke="black" strokeWidth="0.2" opacity="0.1" />
            <line x1="100" y1="0" x2="0" y2="100" stroke="black" strokeWidth="0.2" opacity="0.1" />
          </svg>
        </div>

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
          const point = pos >= 68 ? getFinalPathCoords(tokens[0]?.color || 'red', pos) : getSquareCoords(pos);
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

const HomeArea: React.FC<{ color: PlayerColor; className?: string }> = ({ color, className }) => {
  const colorMap = {
    red: COLORS.red,
    yellow: COLORS.yellow,
    green: COLORS.green,
    blue: COLORS.blue
  };

  return (
    <div className={cn(className, "relative p-4 md:p-10 border-[0.5px] border-black/20")}>
      <div className="w-full h-full relative" style={{ backgroundColor: colorMap[color] }}>
        <div className="grid grid-cols-2 grid-rows-2 gap-4 md:gap-12 p-4 md:p-8 w-full h-full">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-full border-[3px] border-black/20 bg-black/5 aspect-square" />
          ))}
        </div>
      </div>
    </div>
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
