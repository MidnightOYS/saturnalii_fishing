export type Point = { x: number; z: number };
export type LayoutPlanPoint = readonly [number, number];
export type LayoutPoint = readonly [number, number, number];
export type LocationSlot = 'pond' | 'temple';

type Ellipse = Point & { radiusX: number; radiusZ: number; angle: number; shelf: number };

export type LocationLayout = {
  readonly location: string;
  readonly name: string;
  readonly proposed_three_slot: LocationSlot;
  readonly water_polygon_xz: readonly LayoutPlanPoint[];
  readonly blocking_footprints: readonly { name: string; polygon_xz: readonly LayoutPlanPoint[] }[];
  readonly anchors_xyz: {
    readonly boat_spawn: LayoutPoint;
    readonly boat_return: LayoutPoint;
    readonly sea_mouth: LayoutPoint;
    readonly [name: string]: LayoutPoint | undefined;
  };
  readonly anchor_heading_from_east_towards_south_rad: { boat_spawn: number; boat_return: number };
  readonly first_fish_hint_xyz: LayoutPoint;
  readonly water_bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly water_shader_shores_ellipses_approximation: readonly Ellipse[];
  readonly shallow_shelf: readonly { shore_xz: LayoutPlanPoint; break_xz: LayoutPlanPoint; break_depth_m: number }[];
  readonly deep_bottom_y_m: number;
  readonly fx_zones_m: Readonly<Record<string, number>>;
};

type Edge = { a: Point; b: Point; minX: number; maxX: number; minZ: number; maxZ: number };
const tolerance = 1e-8;
const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
const clampUnit = (t: number) => Math.max(0, Math.min(1, t));

export function worldPoint([x, , z]: LayoutPoint): Point {
  return { x, z };
}

export function worldHeading(layoutHeading: number): number {
  return Math.atan2(-Math.cos(layoutHeading), -Math.sin(layoutHeading));
}

function edgesFrom(polygon: readonly LayoutPlanPoint[]): Edge[] {
  const points = polygon.map(([x, z]) => ({ x, z }));
  if (points.length < 3 || points.some(({ x, z }) => !Number.isFinite(x) || !Number.isFinite(z))) {
    throw new Error('Location has an invalid navigation polygon');
  }
  return points.map((a, index) => {
    const b = points[(index + 1) % points.length];
    return { a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  });
}

function contains(edges: readonly Edge[], point: Point): boolean {
  let inside = false;
  for (const { a, b } of edges) {
    if ((a.z > point.z) === (b.z > point.z)) continue;
    if (point.x < a.x + (point.z - a.z) * (b.x - a.x) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

function distanceSquaredToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const x = point.x - a.x;
  const z = point.z - a.z;
  const t = length ? clampUnit((x * dx + z * dz) / length) : 0;
  return (x - dx * t) ** 2 + (z - dz * t) ** 2;
}

// Returns the first overlap on a–b, including a touch at either end or along a collinear edge.
function edgeContact(a: Point, b: Point, edge: Edge): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const sx = edge.b.x - edge.a.x;
  const sz = edge.b.z - edge.a.z;
  const rx = edge.a.x - a.x;
  const rz = edge.a.z - a.z;
  const determinant = cross(dx, dz, sx, sz);
  if (Math.abs(determinant) > tolerance) {
    const t = cross(rx, rz, sx, sz) / determinant;
    const u = cross(rx, rz, dx, dz) / determinant;
    return t >= -tolerance && t <= 1 + tolerance && u >= -tolerance && u <= 1 + tolerance ? clampUnit(t) : Infinity;
  }

  const length = dx * dx + dz * dz;
  if (length <= tolerance ** 2) {
    return distanceSquaredToSegment(a, edge.a, edge.b) <= tolerance ** 2 ? 0 : Infinity;
  }
  if (Math.abs(cross(rx, rz, dx, dz)) > tolerance * Math.sqrt(length)) return Infinity;
  const t1 = (rx * dx + rz * dz) / length;
  const t2 = t1 + (sx * dx + sz * dz) / length;
  const first = Math.max(0, Math.min(t1, t2));
  return first <= Math.min(1, Math.max(t1, t2)) + tolerance ? clampUnit(first) : Infinity;
}

export class LocationNavigation {
  private readonly shore: Edge[];
  private readonly blockers: Edge[][];
  private readonly edges: Edge[];

  constructor(layout: LocationLayout) {
    this.shore = edgesFrom(layout.water_polygon_xz);
    this.blockers = layout.blocking_footprints.map(footprint => edgesFrom(footprint.polygon_xz));
    this.edges = this.shore.concat(...this.blockers);
  }

  private hasWater(point: Point): boolean {
    return contains(this.shore, point) && this.blockers.every(edges => !contains(edges, point));
  }

  private *nearbyEdges(a: Point, b: Point, margin: number): Iterable<Edge> {
    const padding = margin + tolerance;
    const minX = Math.min(a.x, b.x) - padding;
    const maxX = Math.max(a.x, b.x) + padding;
    const minZ = Math.min(a.z, b.z) - padding;
    const maxZ = Math.max(a.z, b.z) + padding;
    for (const edge of this.edges) {
      if (edge.maxX >= minX && edge.minX <= maxX && edge.maxZ >= minZ && edge.minZ <= maxZ) yield edge;
    }
  }

  firstContact(a: Point, b: Point): number {
    if (!this.hasWater(a)) return 0;
    let first = Infinity;
    for (const edge of this.nearbyEdges(a, b, 0)) first = Math.min(first, edgeContact(a, b, edge));
    return first;
  }

  clear(a: Point, b: Point, margin = 0): boolean {
    if (!margin) return this.firstContact(a, b) === Infinity;
    if (!this.hasWater(a)) return false;
    const marginSquared = margin * margin;
    for (const edge of this.nearbyEdges(a, b, margin)) {
      if (edgeContact(a, b, edge) !== Infinity || Math.min(
        distanceSquaredToSegment(a, edge.a, edge.b), distanceSquaredToSegment(b, edge.a, edge.b),
        distanceSquaredToSegment(edge.a, a, b), distanceSquaredToSegment(edge.b, a, b)
      ) <= marginSquared) return false;
    }
    return true;
  }
}
