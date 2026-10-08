// Least-squares superposition of paired 3D points (Horn's quaternion method): the best rotation is
// the eigenvector of the largest eigenvalue of a 4x4 symmetric matrix, found here by Jacobi sweeps.

export type Vec3 = [number, number, number];

const topEigenvector = (matrix: number[][]): number[] => {
  const a = matrix.map(row => row.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const kp = a[k][p], kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < 4; k++) {
          const pk = a[p][k], qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < 4; k++) {
          const kp = v[k][p], kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
};

/**
 * The rigid motion that best maps points `from` onto their partners `to` (same length, at least 3
 * non-collinear pairs), with the root-mean-square deviation left after applying it.
 */
export const superpose = (from: Vec3[], to: Vec3[]): { apply: (p: Vec3) => Vec3; rmsd: number } => {
  const n = from.length;
  const cf: Vec3 = [0, 0, 0];
  const ct: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cf[k] += from[i][k] / n; ct[k] += to[i][k] / n; }

  const s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s[r][c] += (from[i][r] - cf[r]) * (to[i][c] - ct[c]);
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = s;
  const [w, x, y, z] = topEigenvector([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  const rotation = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  const apply = (p: Vec3): Vec3 => {
    const d = [p[0] - cf[0], p[1] - cf[1], p[2] - cf[2]];
    return [0, 1, 2].map(r => rotation[r][0] * d[0] + rotation[r][1] * d[1] + rotation[r][2] * d[2] + ct[r]) as Vec3;
  };

  let squared = 0;
  for (let i = 0; i < n; i++) {
    const p = apply(from[i]);
    squared += (p[0] - to[i][0]) ** 2 + (p[1] - to[i][1]) ** 2 + (p[2] - to[i][2]) ** 2;
  }
  return { apply, rmsd: Math.sqrt(squared / Math.max(n, 1)) };
};
