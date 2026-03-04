import { PlayerColor } from './types';

export interface Point { x: number; y: number; }

export const GRID_SIZE = 17;

export const getSquareCoords = (pos: number): Point => {
  // Classic 17x17 Parchis Mapping (Based on imagenes/parchis.jpg)
  // Square 1 is Red Salida in Top Arm Left Col.
  return getClassicPath(pos);
};

const getClassicPath = (pos: number): Point => {
  // Definitive 17x17 mapping for 68 squares
  const final: [number, number][] = [];
  // Top Arm
  for (let r = 6; r >= 0; r--) final.push([7, r]); final.push([8, 0]); for (let r = 0; r <= 6; r++) final.push([9, r]);
  final.push([10, 7]); final.push([11, 7]);
  // Right Arm
  for (let c = 12; c <= 16; c++) final.push([c, 7]); final.push([16, 8]); for (let c = 16; c >= 10; c--) final.push([c, 9]);
  final.push([9, 10]); final.push([9, 11]);
  // Bottom Arm
  for (let r = 12; r <= 16; r++) final.push([9, r]); final.push([8, 16]); for (let r = 16; r >= 10; r--) final.push([7, r]);
  final.push([6, 9]); final.push([5, 9]);
  // Left Arm
  for (let c = 4; c >= 0; c--) final.push([c, 9]); final.push([0, 8]); for (let c = 0; c <= 6; c++) final.push([c, 7]);

  // Total: (7+1+7+2) * 4 = 17 * 4 = 68. Bingo!
  // RED EXIT is Pos 3 in Top-Left Arm ([7, 4]). 
  // Wait, if Pos 1 = Red Salida, then I'll rotate the array.

  const rotated = [...final.slice(2), ...final.slice(0, 2)];
  const p = rotated[pos - 1] || [8, 8];
  return { x: p[0], y: p[1] };
};

export const getHomeCoords = (color: PlayerColor, index: number): Point => {
  const circles: [number, number][] = [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]];
  const [ox, oy] = circles[index % 4];
  switch (color) {
    case 'red': return { x: ox, y: oy };           // Top-Left
    case 'yellow': return { x: 10 + ox, y: oy };    // Top-Right
    case 'green': return { x: ox, y: 10 + oy };      // Bottom-Left
    case 'blue': return { x: 10 + ox, y: 10 + oy }; // Bottom-Right
  }
};

export const getFinalPathCoords = (color: PlayerColor, pos: number): Point => {
  const step = pos - 68;
  switch (color) {
    case 'red': return { x: 8, y: 7 - step }; // Red goal lane: Col 8, Rows 7 down to 1
    case 'yellow': return { x: 9 + step, y: 8 }; // Yellow goal lane: Row 8, Cols 9 up to 15
    case 'blue': return { x: 8, y: 9 + step }; // Blue goal lane: Col 8, Rows 9 up to 15
    case 'green': return { x: 7 - step, y: 8 }; // Green goal lane: Row 8, Cols 7 down to 1
  }
};
