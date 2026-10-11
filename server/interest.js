'use strict';
// Rebuilt once per tick, queried only in the pilot's 3x3 area of interest.
const SIZE = 1000;
class InterestGrid {
  constructor(rows, xy = row => [row.x, row.y]) {
    this.cells = new Map();
    for (const row of rows) {
      const [x, y] = xy(row), key = `${Math.floor(x / SIZE)}:${Math.floor(y / SIZE)}`;
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, bucket = []);
      bucket.push(row);
    }
  }
  query(x, y) {
    const result = [], cx = Math.floor(x / SIZE), cy = Math.floor(y / SIZE);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bucket = this.cells.get(`${cx + dx}:${cy + dy}`);
      if (bucket) result.push(...bucket);
    }
    return result;
  }
}
module.exports = { InterestGrid, SIZE };
