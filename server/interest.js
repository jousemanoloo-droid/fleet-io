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
  query(x, y, reach = 1) {
    const result = [], cx = Math.floor(x / SIZE), cy = Math.floor(y / SIZE);
    reach = Math.min(2, Math.max(1, reach));
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      const bucket = this.cells.get(`${cx + dx}:${cy + dy}`);
      if (bucket) result.push(...bucket);
    }
    return result;
  }
}
module.exports = { InterestGrid, SIZE };
