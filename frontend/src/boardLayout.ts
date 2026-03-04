import { PlayerColor } from './types';

export interface Point { x: number; y: number; }

export const GRID_SIZE = 17;

const mapBoardPoint = (x: number, z: number): Point => ({
  x: ((x + 30) / 60) * (GRID_SIZE - 1),
  y: ((30 - z) / 60) * (GRID_SIZE - 1),
});

// 68-position route aligned to imagenes/parchis.jpg
const MAIN_PATH_XZ: [number, number][] = [
  [-7, 18], [-7, 15], [-7, 12], [-7, 9],
  [-9, 7], [-12, 7], [-15, 7], [-18, 7], [-21, 7], [-24, 7], [-27, 7], [-30, 7],
  [-30, 0], [-30, -7],
  [-27, -7], [-24, -7], [-21, -7], [-18, -7], [-15, -7], [-12, -7], [-9, -7],
  [-7, -9], [-7, -12], [-7, -15], [-7, -18], [-7, -21], [-7, -24], [-7, -27], [-7, -30],
  [0, -30],
  [7, -30], [7, -27], [7, -24], [7, -21], [7, -18], [7, -15], [7, -12], [7, -9],
  [9, -7], [12, -7], [15, -7], [18, -7], [21, -7], [24, -7], [27, -7], [30, -7],
  [30, 0], [30, 7],
  [27, 7], [24, 7], [21, 7], [18, 7], [15, 7], [12, 7], [9, 7],
  [7, 9], [7, 12], [7, 15], [7, 18], [7, 21], [7, 24], [7, 27], [7, 30],
  [0, 30],
  [-7, 30], [-7, 27], [-7, 24], [-7, 21],
];

const MAIN_PATH = MAIN_PATH_XZ.map(([x, z]) => mapBoardPoint(x, z));

export const getSquareCoords = (pos: number): Point => {
  return MAIN_PATH[pos - 1] || { x: 8, y: 8 };
};

export const getHomeCoords = (color: PlayerColor, index: number): Point => {
  // Position tokens in home circles (initial positions on the board)
  const homes: Record<PlayerColor, [number, number][]> = {
    green:  [[2.5, 2.5], [4.5, 2.5], [2.5, 4.5], [4.5, 4.5]],
    red:    [[12.5, 2.5], [14.5, 2.5], [12.5, 4.5], [14.5, 4.5]],
    yellow: [[2.5, 12.5], [4.5, 12.5], [2.5, 14.5], [4.5, 14.5]],
    blue:   [[12.5, 12.5], [14.5, 12.5], [12.5, 14.5], [14.5, 14.5]],
  };
  const [x, y] = homes[color][index % 4];
  return { x, y };
};

const FINAL_LANES_XZ: Record<PlayerColor, [number, number][]> = {
  // Entrance (69) to square before goal (75)
  green: [[0, 27], [0, 24], [0, 21], [0, 18], [0, 15], [0, 12], [0, 9]],
  red: [[27, 0], [24, 0], [21, 0], [18, 0], [15, 0], [12, 0], [9, 0]],
  blue: [[0, -27], [0, -24], [0, -21], [0, -18], [0, -15], [0, -12], [0, -9]],
  yellow: [[-27, 0], [-24, 0], [-21, 0], [-18, 0], [-15, 0], [-12, 0], [-9, 0]],
};

export const getFinalPathCoords = (color: PlayerColor, pos: number): Point => {
  const lane = FINAL_LANES_XZ[color];
  const idx = Math.max(0, Math.min(lane.length - 1, pos - 69));
  const [x, z] = lane[idx];
  return mapBoardPoint(x, z);
};
