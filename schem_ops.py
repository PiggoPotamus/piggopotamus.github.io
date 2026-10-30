"""Plan a schematic print as fill/clone commands and pack them into bytes.

The print is a list of operations run in order:
  ('fill', (x1, y1, z1, x2, y2, z2), block)
  ('clone', (x1, y1, z1, x2, y2, z2), (dx, dy, dz))   copy the box by (dx, dy, dz)
in schematic cells. A later fill may overwrite an earlier one, so a block type
can be filled straight through cells that a later type replaces ("layering"),
and a finished region can be copied with clone instead of filled again.

Cells are indexed x + z*W + y*W*L, as in schem_to_commands.
"""
from __future__ import annotations

import re
import time
import zlib
from collections import Counter, defaultdict
from itertools import chain, compress, count
from typing import Callable, Dict, List, Optional, Sequence, Tuple

Box = Tuple[int, int, int, int, int, int]

EFFORTS = {
    'fast': dict(orients=2, layered=False, orders=1, vectors=0, seeds=0, rounds=0, seconds=30),
    'balanced': dict(orients=3, layered=True, orders=1, vectors=0, seeds=0, rounds=0, seconds=60),
    'thorough': dict(orients=6, layered=True, orders=3, vectors=16, seeds=300, rounds=8, seconds=120),
    'max': dict(orients=6, layered=True, orders=8, vectors=48, seeds=1000, rounds=16, seconds=300),
}
ORIENTS = [(0, 2, 1), (2, 0, 1), (0, 1, 2), (1, 0, 2), (2, 1, 0), (1, 2, 0)]  # (run, rect, cuboid) axes
MIN_GAIN = 2  # fills a clone must save beyond itself: it takes about 11 bytes to a fill's 8
RUN = re.compile(rb'[\x01\x02]+')
FORBIDDEN = -1  # must stay untouched
EMPTY = -2  # known to be air already: never filled, but a clone may copy it


class Grid:
    def __init__(self, w: int, h: int, l: int):
        self.w, self.h, self.l = w, h, l
        self.v = w * h * l
        self.stride = (1, w * l, w)  # x, y, z

    def index(self, x: int, y: int, z: int) -> int:
        return x + z * self.w + y * self.w * self.l

    def rows(self, box: Box, axis: int):
        """(start index, step, count) of every line along `axis` in box."""
        lo, hi = box[:3], box[3:]
        others = [a for a in (1, 2, 0) if a != axis]
        n = hi[axis] - lo[axis] + 1
        step = self.stride[axis]
        p = list(lo)
        for u in range(lo[others[0]], hi[others[0]] + 1):
            p[others[0]] = u
            for v in range(lo[others[1]], hi[others[1]] + 1):
                p[others[1]] = v
                yield self.index(*p), step, n


def volume(b: Box) -> int:
    return (b[3] - b[0] + 1) * (b[4] - b[1] + 1) * (b[5] - b[2] + 1)



def cover(cls: bytearray, g: Grid, box: Box, order: Tuple[int, int, int]) -> List[Box]:
    """Cuboids that together cover every required cell (2) of cls inside box,
    using only required or free (1) cells, never 0. Lines -> rectangles ->
    cuboids, merging only identical neighbours; each result is then trimmed
    to the extent of the required cells it holds."""
    a, b, c = order
    lo, hi = box[:3], box[3:]
    sa = g.stride[a]
    na = hi[a] - lo[a] + 1
    p = list(lo)
    rects_by_c = []
    span = (na - 1) * sa + 1
    seen: Dict[bytes, List[Tuple[int, int, int, int]]] = {}  # layered rows often repeat
    for cv in range(lo[c], hi[c] + 1):
        p[c] = cv
        runs: Dict[Tuple[int, int], List[Tuple[int, int, int]]] = {}
        for bv in range(lo[b], hi[b] + 1):
            p[b] = bv
            p[a] = lo[a]
            start = g.index(*p)
            row = bytes(cls[start:start + span:sa])
            found = seen.get(row)
            if found is None:
                found = []
                for m in RUN.finditer(row):
                    s, e = m.span()
                    r1 = row.find(2, s, e)
                    found.append((s, e, r1, row.rfind(2, s, e) if r1 >= 0 else -1))
                seen[row] = found
            for s, e, r1, r2 in found:
                key = (s, e)
                lst = runs.get(key)
                if lst is None:
                    runs[key] = [(bv, r1, r2)]
                else:
                    lst.append((bv, r1, r2))
        rects = []
        for (s, e), lst in runs.items():
            b1 = prev = lst[0][0]
            req = None
            for bv, r1, r2 in lst:
                if bv != prev + 1 and bv != b1:
                    rects.append((s, e, b1, prev, req))
                    b1, req = bv, None
                if r1 >= 0:
                    req = [r1, r2, bv, bv] if req is None else [min(req[0], r1), max(req[1], r2), req[2], bv]
                prev = bv
            rects.append((s, e, b1, prev, req))
        rects_by_c.append(rects)
    groups: Dict[Tuple[int, int, int, int], List[Tuple[int, Optional[list]]]] = defaultdict(list)
    for ci, rects in enumerate(rects_by_c):
        cv = lo[c] + ci
        for s, e, b1, b2, req in rects:
            groups[(s, e, b1, b2)].append((cv, req))
    out: List[Box] = []
    q1, q2 = [0, 0, 0], [0, 0, 0]

    def flush(first, last, mn, mx, bmin, bmax):
        q1[a], q2[a] = lo[a] + mn, lo[a] + mx
        q1[b], q2[b] = bmin, bmax
        q1[c], q2[c] = first, last
        out.append((q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]))

    for lst in groups.values():
        prev = None
        have = False
        for cv, r in lst:
            if have and cv != prev + 1:
                flush(first, last, mn, mx, bmin, bmax)
                have = False
            if r is not None:
                if not have:
                    first, mn, mx, bmin, bmax, have = cv, r[0], r[1], r[2], r[3], True
                else:
                    if r[0] < mn: mn = r[0]
                    if r[1] > mx: mx = r[1]
                    if r[2] < bmin: bmin = r[2]
                    if r[3] > bmax: bmax = r[3]
                last = cv
            prev = cv
        if have:
            flush(first, last, mn, mx, bmin, bmax)
    return out


def merge_boxes(boxes: List[Box]) -> List[Box]:
    """Join same-type boxes with the same cross-section that touch or overlap."""
    boxes = list(dict.fromkeys(boxes))
    changed = True
    while changed:
        changed = False
        for ax in range(3):
            u, v = [k for k in range(3) if k != ax]
            groups: Dict[tuple, List[Box]] = defaultdict(list)
            for q in boxes:
                groups[(q[u], q[v], q[u + 3], q[v + 3])].append(q)
            out = []
            for lst in groups.values():
                if len(lst) > 1:
                    lst.sort(key=lambda q: q[ax])
                cur = lst[0]
                for q in lst[1:]:
                    if q[ax] <= cur[ax + 3] + 1:
                        m = list(cur)
                        m[ax + 3] = max(cur[ax + 3], q[ax + 3])
                        cur = tuple(m)
                        changed = True
                    else:
                        out.append(cur)
                        cur = q
                out.append(cur)
            boxes = out
    return boxes


SIMULATE_MAX_CELLS = 30_000_000  # larger builds skip the final check: it would take too long
GREEDY_MAX_CELLS = 300_000  # above this a block type keeps the row search alone


def cover_greedy(cls: bytearray, g: Grid, box: Box, order: Tuple[int, int, int]) -> List[Box]:
    """From each uncovered required cell, the largest box growing along each
    axis of `order` in turn, through required or free cells."""
    lo, hi = box[:3], box[3:]
    todo = bytearray(cls)
    w, wl = g.w, g.w * g.l
    out: List[Box] = []
    start = 0
    while True:
        i = todo.find(2, start)
        if i < 0:
            return out
        start = i
        y, r = divmod(i, wl)
        z, x = divmod(r, w)
        p1, p2 = [x, y, z], [x, y, z]
        for ax in order:
            u, v = [k for k in range(3) if k != ax]

            def clear(value):
                q = [0, 0, 0]
                q[ax] = value
                if ax == 0:  # the new face has one cell per row
                    for q[v] in range(p1[v], p2[v] + 1):
                        for q[u] in range(p1[u], p2[u] + 1):
                            if not cls[q[0] + q[2] * w + q[1] * wl]:
                                return False
                    return True
                n = p2[0] - p1[0] + 1
                other = 2 if ax == 1 else 1
                for q[other] in range(p1[other], p2[other] + 1):
                    s = p1[0] + q[2] * w + q[1] * wl
                    if 0 in cls[s:s + n]:
                        return False
                return True
            while p1[ax] > lo[ax] and clear(p1[ax] - 1):
                p1[ax] -= 1
            while p2[ax] < hi[ax] and clear(p2[ax] + 1):
                p2[ax] += 1
        out.append((p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]))
        n = p2[0] - p1[0] + 1
        for yy in range(p1[1], p2[1] + 1):
            for zz in range(p1[2], p2[2] + 1):
                s = p1[0] + zz * w + yy * wl
                todo[s:s + n] = todo[s:s + n].replace(b'\x02', b'\x01')


class Target:
    """The schematic as small integer types; FORBIDDEN cells must stay untouched."""

    def __init__(self, g: Grid, ids: List[int], names: List[str]):
        self.g, self.ids, self.names = g, ids, names
        self.count = Counter(i for i in ids if i >= 0)
        self.bbox: Dict[int, List[int]] = {}
        w, l = g.w, g.l
        wl = w * l
        for i, t in enumerate(ids):
            if t < 0:
                continue
            bb = self.bbox.get(t)
            y, r = divmod(i, wl)
            z, x = divmod(r, w)
            if bb is None:
                self.bbox[t] = [x, y, z, x, y, z]
            else:
                if x < bb[0]: bb[0] = x
                if x > bb[3]: bb[3] = x
                if y < bb[1]: bb[1] = y
                if y > bb[4]: bb[4] = y
                if z < bb[2]: bb[2] = z
                if z > bb[5]: bb[5] = z


def plan_fills(tg: Target, order: Sequence[int], free: Optional[bytearray], layered: bool,
               orients: int, deadline: float = 0.0) -> List[Tuple[Box, int]]:
    """Fills placing the types in `order`. With `layered`, a type's fills may
    cover cells of types placed after it. `free` marks cells whose content
    does not matter (a later clone writes them)."""
    g = tg.g
    rank = {t: i for i, t in enumerate(order)}
    big = len(order) > 250
    code = bytearray(g.v)
    for i, t in enumerate(tg.ids):
        if t >= 0:
            code[i] = 2 + rank[t] if rank[t] < 253 else 255
    if free is not None:
        for i in range(g.v):
            if free[i] and code[i]:
                code[i] = 1
    cells_by_type = None
    if big:
        cells_by_type = defaultdict(list)
        for i, t in enumerate(tg.ids):
            if t >= 0 and rank[t] >= 253 and code[i] != 1:
                cells_by_type[t].append(i)
    ops: List[Tuple[Box, int]] = []
    for r, t in enumerate(order):
        bb = tg.bbox.get(t)
        if bb is None:
            continue
        if r < 253:
            table = bytearray(256)
            table[1] = 1
            table[2 + r] = 2
            if layered:
                for k in range(3 + r, 256):
                    table[k] = 1
            cls = bytearray(code.translate(table))
        else:
            cls = bytearray(code.translate(bytes([0, 1] + [0] * 254)))
            for i in cells_by_type[t]:
                cls[i] = 2
        if 2 not in cls:
            continue
        box = tuple(bb)
        best = None
        use_greedy = layered and cls.count(2) <= GREEDY_MAX_CELLS
        for o in ORIENTS[:orients]:
            cs = merge_boxes(cover(cls, g, box, o))
            if best is None or len(cs) < len(best):
                best = cs
            if use_greedy:
                cs = merge_boxes(cover_greedy(cls, g, box, o))
                if len(cs) < len(best):
                    best = cs
            if deadline and time.monotonic() > deadline:
                break
        ops.extend((c, t) for c in best)
    return ops


def type_orders(tg: Target, tries: int) -> List[List[int]]:
    """Candidate block-type orders: most cells first, then variations."""
    types = list(tg.count)
    by_count = sorted(types, key=lambda t: (-tg.count[t], t))
    out = [by_count]
    if tries > 1:
        out.append(sorted(types, key=lambda t: (-volume(tuple(tg.bbox[t])), -tg.count[t], t)))
    if tries > 2:
        out.append(sorted(types, key=lambda t: (-tg.count[t] / volume(tuple(tg.bbox[t])), -tg.count[t], t)))
    k = 0
    while len(out) < tries and k < len(by_count) - 1:
        o = list(by_count)
        o[k], o[k + 1] = o[k + 1], o[k]
        out.append(o)
        k += 1
    seen, uniq = set(), []
    for o in out:
        if tuple(o) not in seen:
            seen.add(tuple(o))
            uniq.append(o)
    return uniq



def _planes(tg: Target) -> Tuple[bytes, bytes, bytes]:
    lo = bytes(0 if t == FORBIDDEN else 0xFF if t == EMPTY else t & 0xFF for t in tg.ids)
    hi = bytes(0 if t == FORBIDDEN else 0xFF if t == EMPTY else (t >> 8) + 1 for t in tg.ids)
    ok = bytes(0 if t == FORBIDDEN else 1 for t in tg.ids)
    return lo, hi, ok


EQ = bytes([1] + [0] * 255)  # translate: zero byte -> 1, anything else -> 0


def match_map(g: Grid, planes, t: Tuple[int, int, int], blocked: bytearray) -> bytearray:
    """1 where cell p and p+t hold the same (non-forbidden) type and neither is blocked."""
    lo, hi, ok = planes
    dx, dy, dz = t
    m = bytearray(g.v)
    x1, x2 = max(0, -dx), min(g.w, g.w - dx)
    if x1 >= x2:
        return m
    n = x2 - x1
    off = dx + dz * g.w + dy * g.w * g.l
    for y in range(max(0, -dy), min(g.h, g.h - dy)):
        for z in range(max(0, -dz), min(g.l, g.l - dz)):
            s = g.index(x1, y, z)
            e = s + n
            a = int.from_bytes(lo[s:e], 'little') ^ int.from_bytes(lo[s + off:e + off], 'little')
            b = int.from_bytes(hi[s:e], 'little') ^ int.from_bytes(hi[s + off:e + off], 'little')
            row = (a | b).to_bytes(n, 'little').translate(EQ)
            okrow = int.from_bytes(ok[s:e], 'little') & int.from_bytes(ok[s + off:e + off], 'little') & int.from_bytes(row, 'little')
            okrow &= ~(int.from_bytes(blocked[s:e], 'little') | int.from_bytes(blocked[s + off:e + off], 'little'))
            m[s:e] = okrow.to_bytes(n, 'little')
    return m


def repeat_vectors(g: Grid, planes, limit: int) -> List[Tuple[int, int, int]]:
    """Offsets at which many small patches of the build repeat."""
    lo, hi, ok = planes
    k = 3
    buckets: Dict[bytes, List[Tuple[int, int, int]]] = defaultdict(list)
    step = 2 if g.v > 200_000 else 1
    for y in range(0, g.h - k + 1, step):
        for z in range(0, g.l - k + 1, step):
            for x in range(0, g.w - k + 1, step):
                los, his = [], []
                for dy in range(k):
                    for dz in range(k):
                        s = g.index(x, y + dy, z + dz)
                        los.append(lo[s:s + k])
                        his.append(hi[s:s + k])
                a, b = b''.join(los), b''.join(his)
                if len(set(a)) == 1 and len(set(b)) == 1:
                    continue  # one type only: it matches anywhere
                if b.count(0) * 2 > len(b):
                    continue  # mostly untouched cells
                buckets[a + b].append((x, y, z))
    votes: Counter = Counter()
    for pos in buckets.values():
        if len(pos) < 2:
            continue
        pos = pos[:40]
        for i in range(len(pos)):
            for j in range(i + 1, len(pos)):
                d = (pos[j][0] - pos[i][0], pos[j][1] - pos[i][1], pos[j][2] - pos[i][2])
                if d < (0, 0, 0):
                    d = (-d[0], -d[1], -d[2])
                votes[d] += 1
    out = []
    ranked = [v for v, _ in votes.most_common()]
    straight = [next((v for v in ranked if v[a] and not v[(a + 1) % 3] and not v[(a + 2) % 3]), None) for a in range(3)]
    tops = [v for v in straight if v] + ranked[:limit]
    for v in dict.fromkeys(tops):
        k = 1
        while abs(v[0] * k) < g.w and abs(v[1] * k) < g.h and abs(v[2] * k) < g.l:
            if (v[0] * k, v[1] * k, v[2] * k) not in out:
                out.append((v[0] * k, v[1] * k, v[2] * k))
            k *= 2
    return out[:limit * 3]


def grow(g: Grid, m: bytearray, seed: Tuple[int, int, int], cap: Tuple[int, int, int]) -> Optional[Box]:
    """Greedy largest box of 1s in m around seed, x then z then y, each axis
    length at most cap."""
    x, y, z = seed
    i = g.index(x, y, z)
    if not m[i]:
        return None
    x1 = x
    while x1 > 0 and x - x1 + 1 < cap[0] and m[i - (x - x1) - 1]:
        x1 -= 1
    x2 = x
    while x2 < g.w - 1 and x2 - x1 + 1 < cap[0] and m[i + (x2 - x) + 1]:
        x2 += 1
    n = x2 - x1 + 1

    def rows_ok(y1, y2, z1, z2):
        for yy in range(y1, y2 + 1):
            for zz in range(z1, z2 + 1):
                s = g.index(x1, yy, zz)
                if m.find(0, s, s + n) >= 0:
                    return False
        return True
    z1 = z2 = z
    y1 = y2 = y
    while z1 > 0 and z2 - z1 + 1 < cap[2] and rows_ok(y1, y2, z1 - 1, z1 - 1):
        z1 -= 1
    while z2 < g.l - 1 and z2 - z1 + 1 < cap[2] and rows_ok(y1, y2, z2 + 1, z2 + 1):
        z2 += 1
    while y1 > 0 and y2 - y1 + 1 < cap[1] and rows_ok(y1 - 1, y1 - 1, z1, z2):
        y1 -= 1
    while y2 < g.h - 1 and y2 - y1 + 1 < cap[1] and rows_ok(y2 + 1, y2 + 1, z1, z2):
        y2 += 1
    return (x1, y1, z1, x2, y2, z2)


class OpIndex:
    """Fill boxes bucketed by their low corner, to count fills inside a box."""
    CELL = 8

    def __init__(self, boxes: List[Box]):
        self.boxes = boxes
        self.alive = [True] * len(boxes)
        self.buckets: Dict[Tuple[int, int, int], List[int]] = defaultdict(list)
        for k, b in enumerate(boxes):
            self.buckets[(b[0] // self.CELL, b[1] // self.CELL, b[2] // self.CELL)].append(k)

    def inside(self, d: Box) -> List[int]:
        c = self.CELL
        out = []
        for bx in range(d[0] // c, d[3] // c + 1):
            for by in range(d[1] // c, d[4] // c + 1):
                for bz in range(d[2] // c, d[5] // c + 1):
                    for k in self.buckets.get((bx, by, bz), ()):
                        b = self.boxes[k]
                        if self.alive[k] and d[0] <= b[0] and b[3] <= d[3] and d[1] <= b[1] and b[4] <= d[4] and d[2] <= b[2] and b[5] <= d[5]:
                            out.append(k)
        return out


def plan_clones(tg: Target, base: List[Tuple[Box, int]], vecs, seeds: int, max_volume: int,
                deadline: float, dests: List[Box], planes) -> List[Tuple[Box, Tuple[int, int, int]]]:
    """Greedy: copy a box onto an identical box when that replaces at least
    two fills of the base plan. Returns (source box, offset) in pick order;
    destination boxes never overlap each other (or `dests`, already chosen)
    or their own source."""
    g = tg.g
    idx = OpIndex([b for b, _ in base])
    picks: List[Tuple[Box, Tuple[int, int, int]]] = []
    cands = []  # (-gain, dest box, offset source->dest)
    blocked = bytearray(g.v)
    for d in dests:
        for s, _, n in g.rows(d, 0):
            blocked[s:s + n] = b'\x01' * n
    order = sorted(range(len(idx.boxes)), key=lambda k: idx.boxes[k][:3])
    stepk = max(1, len(order) // max(1, seeds))
    for t in vecs:
        if time.monotonic() > deadline:
            break
        m = match_map(g, planes, t, blocked)  # p and p+t match
        ax = max(range(3), key=lambda k: abs(t[k]))
        cap = [g.w, g.h, g.l]
        cap[ax] = min(cap[ax], abs(t[ax]))
        grown: List[Box] = []
        for k in order[::stepk]:
            if time.monotonic() > deadline:
                break
            b = idx.boxes[k]
            for sign in (1,):
                sx, sy, sz = (b[0] - t[0], b[1] - t[1], b[2] - t[2]) if sign == 1 else b[:3]
                if not (0 <= sx < g.w and 0 <= sy < g.h and 0 <= sz < g.l):
                    continue
                if any(q[0] <= sx <= q[3] and q[1] <= sy <= q[4] and q[2] <= sz <= q[5] for q in grown):
                    continue
                box = grow(g, m, (sx, sy, sz), cap)
                if box is None:
                    continue
                grown.append(box)
                if sign == 1:
                    src, dst, off = box, tuple(box[i] + t[i % 3] for i in range(6)), t
                else:
                    src, dst, off = tuple(box[i] + t[i % 3] for i in range(6)), box, (-t[0], -t[1], -t[2])
                if volume(dst) > max_volume:
                    continue
                gain = len(idx.inside(dst)) - 1
                if gain >= MIN_GAIN:
                    cands.append((-gain, -volume(dst), dst, off, src))
    import heapq
    heapq.heapify(cands)
    while cands:
        ng, nv, dst, off, src = heapq.heappop(cands)
        if any(_overlap(dst, d) or _overlap(src, d) for d in dests):
            continue
        inside = idx.inside(dst)
        gain = len(inside) - 1
        if gain < MIN_GAIN:
            continue
        if cands and (-gain, nv) > cands[0][:2]:
            heapq.heappush(cands, (-gain, nv, dst, off, src))  # stale: re-rank
            continue
        for k in inside:
            idx.alive[k] = False
        dests.append(dst)
        picks.append((src, off))
    return picks


def _overlap(a: Box, b: Box) -> bool:
    return a[0] <= b[3] and b[0] <= a[3] and a[1] <= b[4] and b[1] <= a[4] and a[2] <= b[5] and b[2] <= a[5]


def schedule_clones(g: Grid, tg: Target, picks):
    """Order clones so each source is complete when it is copied. Returns the
    run order and the `free` map: dest cells no fill needs to get right."""
    dest_of = bytearray(g.v)  # 1 = written by some clone
    for src, off in picks:
        for s, step, n in g.rows(_shift(src, off), 0):
            dest_of[s:s + n] = b'\x01' * n
    required = bytearray(b'\x01' * g.v)
    for i in range(g.v):
        if dest_of[i]:
            required[i] = 0
    done = [False] * len(picks)
    ready = bytearray(required)  # correct right after the fills
    order = []
    while len(order) < len(picks):
        progress_made = False
        for k, (src, off) in enumerate(picks):
            if done[k]:
                continue
            if all(0 not in ready[s:s + n] for s, _, n in g.rows(src, 0)):
                done[k] = True
                order.append(k)
                for s, _, n in g.rows(_shift(src, off), 0):
                    ready[s:s + n] = b'\x01' * n
                progress_made = True
        if not progress_made:
            k = min((k for k in range(len(picks)) if not done[k]),
                    key=lambda k: sum(n - ready[s:s + n].count(1) for s, _, n in g.rows(picks[k][0], 0)))
            for s, _, n in g.rows(picks[k][0], 0):
                for i in range(s, s + n):
                    if not ready[i]:
                        ready[i] = required[i] = 1
    free = bytearray(g.v)
    for i in range(g.v):
        if not required[i]:
            free[i] = 1
    return [picks[k] for k in order], free


def _shift(b: Box, off) -> Box:
    return (b[0] + off[0], b[1] + off[1], b[2] + off[2], b[3] + off[0], b[4] + off[1], b[5] + off[2])



def simulate(tg: Target, ops) -> Optional[str]:
    """None when running ops leaves exactly the target; else what is wrong."""
    g = tg.g
    world = [EMPTY if t == EMPTY else None for t in tg.ids]  # None: untouched
    for op in ops:
        if op[0] == 'fill':
            box, t = op[1], op[2]
            for s, _, n in g.rows(box, 0):
                world[s:s + n] = [t] * n
        else:
            src, off = op[1], op[2]
            rows = [(s, n) for s, _, n in g.rows(src, 0)]
            data = [world[s:s + n] for s, n in rows]
            if any(None in d for d in data):
                return f'clone {src} copies cells nothing has placed yet'
            shift = off[0] + off[2] * g.w + off[1] * g.w * g.l
            for (s, n), d in zip(rows, data):
                world[s + shift:s + shift + n] = d
    for i, (w, t) in enumerate(zip(world, tg.ids)):
        if t == FORBIDDEN:
            if w is not None:
                return f'cell {i} must stay untouched but was set'
        elif w != t:
            return f'cell {i} is {w}, expected {t}'
    return None



def split_box(b: Box, max_volume: int) -> List[Box]:
    if volume(b) <= max_volume:
        return [b]
    lens = [b[3] - b[0] + 1, b[4] - b[1] + 1, b[5] - b[2] + 1]
    ax = max(range(3), key=lambda k: lens[k])
    per = max(1, max_volume // (volume(b) // lens[ax]))
    out = []
    for s in range(b[ax], b[ax + 3] + 1, per):
        q = list(b)
        q[ax], q[ax + 3] = s, min(b[ax + 3], s + per - 1)
        out.extend(split_box(tuple(q), max_volume))
    return out


def est_bytes(ops) -> int:
    return sum(8 if op[0] == 'fill' else 11 for op in ops)


def clone_search(tg, order, ops, e, vectors, seeds, rounds, max_volume, deadline, planes, say):
    """Rounds of copies, each round's fills re-planned around them. Returns
    the best checked plan and its clone count."""
    vecs = repeat_vectors(tg.g, planes, vectors)
    say(f'Clone search: {len(vecs)} repeat offsets')
    picks, cur, best_free, best_run = [], plan_fills(tg, order, None, False, 2), None, []
    straight = [v for v in vecs if sum(1 for c in v if c) == 1]
    use = straight or vecs
    for rnd in range(rounds):
        if time.monotonic() > deadline:
            break
        new = plan_clones(tg, cur, use, seeds, max_volume, deadline, [_shift(s, o) for s, o in picks], planes)
        if not new and use is straight:
            use = vecs
            new = plan_clones(tg, cur, use, seeds, max_volume, deadline, [_shift(s, o) for s, o in picks], planes)
        if not new:
            break
        run, free = schedule_clones(tg.g, tg, picks + new)
        fills2 = plan_fills(tg, order, free, e['layered'], 2)
        cand = [('fill', b, t) for b, t in fills2] + [('clone', src, off) for src, off in run]
        say(f'Clone round {rnd + 1}: {len(run):,} clones, {len(fills2):,} fills')
        picks = picks + new
        cur = plan_fills(tg, order, free, False, 2)
        if est_bytes(cand) < est_bytes(ops):
            err = simulate(tg, cand)
            if err:
                say(f'Clone plan failed its check ({err}); keeping the previous plan')
                break
            ops, best_free, best_run = cand, free, run
    if best_run and time.monotonic() < deadline:
        fills3 = plan_fills(tg, order, best_free, e['layered'], e['orients'])
        cand = [('fill', b, t) for b, t in fills3] + [('clone', s, o) for s, o in best_run]
        if est_bytes(cand) < est_bytes(ops) and simulate(tg, cand) is None:
            ops = cand
    return ops, len(best_run)


def plan(tg: Target, effort: str, max_volume: int, progress: Optional[Callable[[str], None]] = None,
         time_limit: float = 0.0, on_first: Optional[Callable[[int], None]] = None) -> Tuple[list, dict]:
    """The op list for tg and some statistics. on_first gets the command count
    of the first fill plan, an early upper estimate."""
    e = EFFORTS[effort]
    t0 = time.monotonic()
    deadline = t0 + (time_limit or e['seconds'])
    say = progress or (lambda m: None)
    orders = type_orders(tg, e['orders'])
    best = None
    screen = 2 if len(orders) > 1 else e['orients']
    for k, order in enumerate(orders, 1):
        fills = plan_fills(tg, order, None, e['layered'], screen)
        say(f'Fill plan {k}/{len(orders)}: {len(fills):,} fills')
        if k == 1 and on_first:
            on_first(len(fills))
        if best is None or len(fills) < len(best[1]):
            best = (order, fills)
        if time.monotonic() > deadline:
            break
    order, fills = best
    if screen != e['orients'] and time.monotonic() < deadline:
        full = plan_fills(tg, order, None, e['layered'], e['orients'])
        if len(full) < len(fills):
            fills = full
    stats = {'fills_without_clones': len(fills), 'clones': 0, 'type_orders': len(orders)}
    ops = [('fill', b, t) for b, t in fills]
    if e['vectors'] and len(fills) > 4:
        planes = _planes(tg)
        searches = [(EFFORTS['thorough']['vectors'], EFFORTS['thorough']['seeds'], EFFORTS['thorough']['rounds'])]
        if (e['vectors'], e['seeds'], e['rounds']) != searches[0]:
            searches.append((e['vectors'], e['seeds'], e['rounds']))
        for vectors, seeds, rounds in searches:
            found, clones = clone_search(tg, order, ops, e, vectors, seeds, rounds, max_volume, deadline, planes, say)
            if clones and est_bytes(found) < est_bytes(ops):
                ops, stats['clones'] = found, clones
    if tg.g.v <= SIMULATE_MAX_CELLS:
        err = simulate(tg, ops)
        if err:
            raise ValueError(f'the print plan failed its check: {err}')
    out = []
    for op in ops:
        if op[0] == 'fill':
            out.extend(('fill', b, op[2]) for b in split_box(op[1], max_volume))
        else:
            out.append(op)
    stats['ops'] = len(out)
    stats['seconds'] = round(time.monotonic() - t0, 2)
    return out, stats



OP_END = 'strict","'
MERGE_MIN = 160  # a merged token must save more than its table entry weighs
OP_BLOCK, OP_FILL, OP_CLONE = 0, 1, 2


def coord_text(v: int) -> str:
    return ('~' if v == 0 else f'~{v}') + ' '


def wide_parts(v: int) -> Tuple[str, str]:
    q, r = divmod(abs(v), 100)
    return '~' + ('-' if v < 0 else '') + (str(q) if q else ''), f'{r:02d} '


def byte_key(k: int) -> str:
    return f'{k if k < 128 else k - 256}b'


class Encoded:
    def __init__(self, table: Dict[str, str], chunks: List[List[int]], ops_per_chunk: List[int]):
        self.table, self.chunks, self.ops_per_chunk = table, chunks, ops_per_chunk

    @property
    def nbytes(self) -> int:
        return sum(len(c) for c in self.chunks)


def encode(ops, names: Dict[int, str], off: Tuple[int, int, int], base: str, chunk_bytes: int = 1000) -> Encoded:
    """base starts every command, e.g. "execute at <anchor> "."""
    ox, oy, oz = off
    coords, kinds = [], []  # all coordinates in order; each op's kind and block
    for op in ops:
        x1, y1, z1, x2, y2, z2 = op[1]
        if op[0] == 'fill':
            if x1 == x2 and y1 == y2 and z1 == z2:
                coords += (x1 + ox, y1 + oy, z1 + oz)
                kinds.append((OP_BLOCK, op[2]))
            else:
                coords += (x1 + ox, y1 + oy, z1 + oz, x2 - x1, y2 - y1, z2 - z1)
                kinds.append((OP_FILL, op[2]))
        else:
            d = op[2]
            coords += (x1 + ox, y1 + oy, z1 + oz, x2 + ox, y2 + oy, z2 + oz, x1 + d[0] + ox, y1 + d[1] + oy, z1 + d[2] + oz)
            kinds.append((OP_CLONE, -1))
    values = Counter(coords)
    blocks = Counter(k[1] for k in kinds if k[0] != OP_CLONE)
    used_kinds = {k[0] for k in kinds}
    nfixed = len(used_kinds) + (OP_FILL in used_kinds) + (OP_CLONE in used_kinds)  # the fill's "run fill", the clone's end
    best = None
    for reserve in (0, 24, 64):
        cand = _encode(coords, kinds, values, blocks, names, base, nfixed, reserve, chunk_bytes)
        if cand is None:
            continue
        if best is None or cand.nbytes < best.nbytes:
            best = cand
        if cand.saturated is False:
            break
    if best is None:
        raise ValueError('the schematic has too many block types for one table')
    return best


def _encode(coords, kinds, values, blocks, names, base, nfixed, reserve, chunk_bytes):
    vocab = choose_vocab(values, blocks, names, nfixed, reserve)
    if vocab is None:
        return None
    text = {('S',): base + 'run setblock ', ('F',): base + 'positioned ', ('R',): 'run fill ~ ~ ~ ',
            ('C',): base + 'run clone ', ('E',): OP_END}
    sym_id: Dict[tuple, int] = {}
    syms_list: List[tuple] = []

    def sid(sym):
        i = sym_id.get(sym)
        if i is None:
            i = sym_id[sym] = len(syms_list)
            syms_list.append(sym)
        return i

    def expand_value(v):
        if v in vocab['direct']:
            return [sid(('V', v))]
        h, s = wide_parts(v)
        return [sid(('H', h)), sid(('S2', s))]

    def expand_block(b):
        if b in vocab['full']:
            return [sid(('B', b))]
        stem, tail = split_state(names[b])
        if vocab['pairs']:
            return [sid(('ST', stem)), sid(('TL', tail))]
        return [sid(('CH', ch)) for ch in stem + tail] + [sid(('TL', ''))]
    v_tokens = {v: expand_value(v) for v in values}
    b_tokens = {b: expand_block(b) for b in blocks}
    block_id, fill_id, run_id, clone_id, end_id = sid(('S',)), sid(('F',)), sid(('R',)), sid(('C',)), sid(('E',))
    flat: List[int] = []
    i = 0
    get = v_tokens.__getitem__
    for kind, b in kinds:
        if kind == OP_BLOCK:
            flat.append(block_id)
            flat.extend(chain.from_iterable(map(get, coords[i:i + 3])))
            i += 3
            flat += b_tokens[b]
        elif kind == OP_FILL:
            flat.append(fill_id)
            flat.extend(chain.from_iterable(map(get, coords[i:i + 3])))
            flat.append(run_id)
            flat.extend(chain.from_iterable(map(get, coords[i + 3:i + 6])))
            i += 6
            flat += b_tokens[b]
        else:
            flat.append(clone_id)
            flat.extend(chain.from_iterable(map(get, coords[i:i + 9])))
            i += 9
            flat.append(end_id)
        flat.append(-1)
    used = set(flat)
    used.discard(-1)

    def sym_text(s):
        k = s[0]
        if k == 'V':
            return coord_text(s[1])
        if k in ('H', 'S2', 'CH', 'ST'):
            return s[1]
        if k == 'B':
            return names[s[1]] + ' ' + OP_END
        if k == 'TL':
            return s[1] + ' ' + OP_END
        if k == 'M':
            return sym_text(s[1]) + sym_text(s[2])
        return text[s]
    slots = 256 - len(used)
    if slots < 0:
        return None
    saturated = slots <= 8
    while slots > 0:
        pairs = Counter(zip(flat, flat[1:]))
        for pair in [q for q in pairs if q[0] < 0 or q[1] < 0]:
            del pairs[pair]
        chosen = [q for q, n in pairs.most_common(min(slots, 32)) if n > MERGE_MIN]
        if not chosen:
            break
        chosen_set = {q: sid(('M', syms_list[q[0]], syms_list[q[1]])) for q in chosen}
        out, i, n = [], 0, len(flat)
        while i < n:
            if i + 1 < n and (flat[i], flat[i + 1]) in chosen_set:
                out.append(chosen_set[(flat[i], flat[i + 1])])
                i += 2
            else:
                out.append(flat[i])
                i += 1
        flat = out
        used = set(flat)
        used.discard(-1)
        slots = 256 - len(used)
    ordered = sorted((syms_list[i] for i in used), key=repr)
    ids = {sym_id[s]: k for k, s in enumerate(ordered)}
    table = {byte_key(k): sym_text(s) for k, s in enumerate(ordered)}
    stream = bytes(map(ids.__getitem__, filter((-1).__ne__, flat)))
    ends = compress(count(), map((-1).__eq__, flat))
    chunks, counts = [], []
    begin = n = start = 0
    for done, sep in enumerate(ends):
        end = sep - done  # stream offset of this op's end
        if end - begin > chunk_bytes and start > begin:
            chunks.append(stream[begin:start])
            counts.append(n)
            begin, n = start, 0
        start = end
        n += 1
    if start > begin:
        chunks.append(stream[begin:start])
        counts.append(n)
    enc = Encoded(table, chunks, counts)
    enc.saturated = saturated
    return enc


def split_state(name: str) -> Tuple[str, str]:
    """"oak_stairs[facing=east]" -> ("oak_stairs", "[facing=east]")."""
    i = name.find('[')
    return (name, '') if i < 0 else (name[:i], name[i:])


def choose_vocab(values: Counter, blocks: Counter, names: Dict[int, str], nfixed: int, reserve: int = 0) -> Optional[dict]:
    """Which coordinates get their own token and which blocks a whole-name
    token, for the fewest bytes in 256 table slots, keeping `reserve` slots
    free. Other blocks are a block token plus a properties token, or if that
    does not fit, spelt letter by letter."""
    vals = [v for v, _ in values.most_common()]
    blks = [b for b, _ in blocks.most_common()]
    best = None
    step = max(1, len(blks) // 24)
    for nfull in range(len(blks), -1, -step):
        full = set(blks[:nfull])
        rest = blks[nfull:]
        parts = [split_state(names[b]) for b in rest]
        for pairs in (True, False):
            if pairs:
                need = len({s for s, _ in parts}) + len({t for _, t in parts})
                rest_cost = 2
            else:
                need = len({c for s, t in parts for c in s + t}) + (1 if rest else 0)
                rest_cost = None
            used = nfixed + nfull + need + reserve
            if used + len(vals) <= 256:
                direct = set(vals)
            else:
                direct = None
                for nd in range(min(len(vals), 256 - used - 100), -1, -1):
                    pref = {wide_parts(v)[0] for v in vals[nd:]}
                    if used + 100 + len(pref) + nd <= 256:
                        direct = set(vals[:nd])
                        break
                if direct is None:
                    continue
            cost = sum(values[v] * (1 if v in direct else 2) for v in vals) + sum(blocks[b] for b in full)
            cost += sum(blocks[b] * (rest_cost if pairs else len(names[b]) + 1) for b in rest)
            if best is None or cost < best[0]:
                best = (cost, {'direct': direct, 'full': full, 'pairs': pairs})
    return best[1] if best else None


def nbt_weight_table(table: Dict[str, str]) -> int:
    return 48 + sum(32 + 36 + 2 * len(k) + 36 + 2 * len(v) for k, v in table.items())


def nbt_weight_chunks(chunks: List[List[int]]) -> int:
    return 36 + sum(4 + 24 + len(c) for c in chunks)


def nbt_weight_strings(items: List[str]) -> int:
    return 36 + sum(4 + 36 + 2 * len(s) for s in items)


BYTE_TEXT = [f'{v if v < 128 else v - 256}b' for v in range(256)]


def snbt_bytes(chunk: List[int]) -> str:
    return '[B;' + ','.join(map(BYTE_TEXT.__getitem__, chunk)) + ']'



X0, Z0 = 28800018, 28800002
HELPER_AT = (28800020, 190, 28800005)
HELPERS = {'TDG': (82730, 82730, 22730, 1), 'MG': (82730, 82730, 22730, 2),
           'TDB': (82730, 82730, 22730, 3), 'MB': (82730, 82730, 22730, 4)}


def uuid_text(ints) -> str:
    h = ''.join(f'{i & 0xFFFFFFFF:08x}' for i in ints)
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}'


U = {k: uuid_text(v) for k, v in HELPERS.items()}
HELPER_SEL = '@e[tag=p2.h,x=%d,y=%d,z=%d,distance=..1]' % HELPER_AT


def summon_helper(name: str, nbt: str = '') -> str:
    kind = 'text_display' if name.startswith('TD') else 'marker'
    ints = ','.join(str(i) for i in HELPERS[name])
    extra = ',view_range:0f' if kind == 'text_display' else ''
    return 'summon %s %d %d %d {UUID:[I;%s],Tags:["p2.h","p2.x"]%s%s}' % ((kind, *HELPER_AT, ints, extra, nbt))


def snbt(v) -> str:
    import json
    if isinstance(v, bool):
        return '1b' if v else '0b'
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return '[' + ','.join(map(snbt, v)) + ']'
    return '{' + ','.join((k if re.fullmatch(r'[A-Za-z0-9_.+-]+', k) else snbt(k)) + ':' + snbt(x)
                          for k, x in v.items()) + '}'


def decode_template() -> dict:
    """TDG's text: resolves to a command summoning TDB, whose text is
    `data modify storage p2:l N set value ["` + one table lookup per byte + `"]`."""
    head = summon_helper('TDB', ',text:{text:"",extra:[')[:-1] + '"data modify storage p2:l N set value [\\"",{nbt:"t.'
    sep = '",storage:"p2:t",interpret:1b},{nbt:"t.'
    tail = '",storage:"p2:t",interpret:1b},"\\"]"]}}'
    return {'text': '', 'extra': [head, {'nbt': 'c[]', 'storage': 'p2:b', 'separator': sep}, tail]}


def esc(cmd: str) -> str:
    return cmd.replace('\\', '\\\\').replace("'", "\\'").replace('"', '\\"')


def ring(y0: int, entry: list, body: list, start: bool = False) -> List[tuple]:
    """Blocks (x, y, z, kind, facing, cmd, auto, ule, track) of a looping chain.
    entry[0] is the repeating head at (X0, y0, Z0); entry goes up to the gate
    (entry[-1]); the body snakes east/west over the rows z0.. at the gate's
    height and returns north along x0 into the gate. Names are ('name', cmd)."""
    out = []
    yg = y0 + len(entry) - 1
    for i, c in enumerate(entry):
        name, cmd, track = (c + (False,))[:3] if isinstance(c, tuple) else (None, c, False)
        kind = 'repeating' if i == 0 else 'chain'
        facing = 'east' if i == len(entry) - 1 else 'up'
        ule = i not in (0, len(entry) - 1)
        out.append((name, X0, y0 + i, Z0, kind, facing, cmd, i != 0 or start, ule, track))
    pairs = 1
    while 8 * pairs + 2 * pairs - 1 < len(body):
        pairs += 1
    if pairs > 3:
        raise ValueError('ring body too long')
    cells = []
    for r in range(2 * pairs):
        z = Z0 + r
        xs = range(X0 + 1, X0 + 5) if r % 2 == 0 else range(X0 + 4, X0, -1)
        for j, x in enumerate(xs):
            last = j == 3
            if r % 2 == 0:
                facing = 'south' if last else 'east'
            else:
                facing = ('west' if r == 2 * pairs - 1 else 'south') if last else 'west'
            cells.append((x, z, facing))
    for z in range(Z0 + 2 * pairs - 1, Z0, -1):
        cells.append((X0, z, 'north'))
    body = list(body) + [''] * (len(cells) - len(body))
    for (x, z, facing), c in zip(cells, body):
        name, cmd, track = (c + (False,))[:3] if isinstance(c, tuple) else (None, c, False)
        out.append((name, x, yg, z, 'chain', facing, cmd, True, True, track))
    return out


def setblocks(blocks: List[tuple]) -> List[str]:
    names = {b[0]: '%d %d %d' % b[1:4] for b in blocks if b[0]}
    out = []
    for name, x, y, z, kind, facing, cmd, auto, ule, track in blocks:
        for k, v in names.items():
            cmd = cmd.replace('{' + k + '}', v)
        out.append(f"setblock {x} {y} {z} {kind}_command_block[facing={facing}]"
                   f"{{auto:{'1b' if auto else '0b'},TrackOutput:{'1b' if track else '0b'}"
                   f"{',UpdateLastExecution:0b' if ule else ''},Command:'{esc(cmd)}'}} replace")
    return out


def executor_blocks() -> List[str]:
    """Built by the loader's minecarts; its head is 28800018 176 28800002."""
    skip = 'run data modify block {GE} LastExecution set from block {RE} LastExecution'
    return setblocks(ring(176, [
        ('RE', 'scoreboard players set #n p2 0'),
        'execute unless data storage p2:l C[0] if data storage p2:l E[0] run data modify storage p2:l Q append from storage p2:l E[]',
        'execute unless data storage p2:l C[0] run data remove storage p2:l E',
        'execute unless data storage p2:l Q[0] unless data storage p2:l C[0] run data merge block 28800024 176 28800002 {auto:1b}',
        'execute unless data storage p2:l Q[0] ' + skip,
        ('GE', 'data modify block {EX} Command set from storage p2:l Q[0]'),
    ], [
        ('EX', ''),
        'data remove storage p2:l Q[0]',
        'scoreboard players add #n p2 1',
        'execute if score #n p2 < #m p2 if data storage p2:l Q[0] run data modify block {GE} LastExecution set value 0L',
    ]))


def decoder_blocks() -> List[str]:
    """Set up by the executor (the item's S list) when printing starts."""
    skip = 'run data modify block {GD} LastExecution set from block {RD} LastExecution'
    tdg = snbt(decode_template())
    return setblocks(ring(182, [
        ('RD', 'execute store result score #q p2 if data storage p2:l Q[]'),
        'execute if score #q p2 >= #m p2 ' + skip,
        'execute unless data storage p2:l C[0] ' + skip,
        ('GD', 'data modify storage p2:b c set from storage p2:l C[0]'),
    ], [
        'data remove storage p2:l C[0]',
        'kill ' + HELPER_SEL,
        summon_helper('TDG', ',text:' + tdg),
        summon_helper('MG'),
        f'data modify entity {U["MG"]} CustomName set from entity {U["TDG"]} text',
        ('EP', f'enchant {U["MG"]} lure', True),
        'data modify block {SP} Command set string block {EP} LastOutput.extra[0].extra[0].with[0]',
        ('SP', ''),  # summons TDB
        summon_helper('MB'),
        f'data modify entity {U["MB"]} CustomName set from entity {U["TDB"]} text',
        ('EP2', f'enchant {U["MB"]} lure', True),
        'data modify block {SP2} Command set string block {EP2} LastOutput.extra[0].extra[0].with[0]',
        ('SP2', ''),  # sets N to this chunk's commands
        'data remove storage p2:l N[-1]',
        'data modify storage p2:l Q append from storage p2:l N[]',
        'execute store result score #q p2 if data storage p2:l Q[]',
        'execute if score #q p2 < #m p2 if data storage p2:l C[0] run data modify block {GD} LastExecution set value 0L',
    ], start=True))



NBT_QUOTA = 2097152  # a received item's NBT weight limit (NbtAccounter)
QUOTA_SHARE = 0.95   # leave room for whatever a client or mod adds


class _SNBT:
    def __init__(self, s: str, i: int = 0):
        self.s, self.i = s, i

    def ws(self):
        while self.i < len(self.s) and self.s[self.i] in ' \n\r\t':
            self.i += 1

    def value(self):
        self.ws()
        c = self.s[self.i]
        if c == '{':
            return self.comp()
        if c == '[':
            m = re.match(r'\[([BIL]);', self.s[self.i:self.i + 3])
            if m:  # counted without reading each element: chunks are most of an item
                end = self.s.index(']', self.i)
                n = self.s.count(',', self.i, end) + 1 if end > self.i + 3 else 0
                self.i = end + 1
                return ('arr', m.group(1), n)
            self.i += 1
            return ('list', self.seq())
        if c in '"\'':
            return ('str', self.quoted())
        m = re.compile(r'[^,\]}\s:]+').match(self.s, self.i)
        self.i = m.end()
        t = m.group(0)
        if re.fullmatch(r'-?\d+[bBsS]?|true|false', t):
            return ('byte' if t[-1] in 'bB' or t in ('true', 'false') else 'int',)
        if re.fullmatch(r'-?[\d.]+(e-?\d+)?[dDfFlL]?', t):
            return ('num',)
        return ('str', t)

    def quoted(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while self.s[self.i] != q:
            if self.s[self.i] == '\\':
                self.i += 1
            out.append(self.s[self.i])
            self.i += 1
        self.i += 1
        return ''.join(out)

    def seq(self):
        items = []
        self.ws()
        while self.s[self.i] != ']':
            items.append(self.value())
            self.ws()
            if self.s[self.i] == ',':
                self.i += 1
                self.ws()
        self.i += 1
        return items

    def comp(self):
        self.i += 1
        out = []
        self.ws()
        while self.s[self.i] != '}':
            if self.s[self.i] in '"\'':
                k = self.quoted()
            else:
                m = re.compile(r'[^:\s]+').match(self.s, self.i)
                k = m.group(0)
                self.i = m.end()
            self.ws()
            self.i += 1
            out.append((k, self.value()))
            self.ws()
            if self.s[self.i] == ',':
                self.i += 1
                self.ws()
        self.i += 1
        return ('comp', out)


def _weight(v) -> int:
    t = v[0]
    if t == 'str':
        return 36 + 2 * len(v[1])
    if t == 'arr':
        return 24 + {'B': 1, 'I': 4, 'L': 8}[v[1]] * v[2]
    if t == 'byte':
        return 9
    if t == 'int':
        return 12
    if t == 'num':
        return 16
    if t == 'list':
        return 36 + sum(4 + _weight(x) for x in v[1])
    return 48 + sum(32 + 36 + 2 * len(k) + _weight(x) for k, x in v[1])


def item_weight(give: str) -> int:
    """The server's weight for the item in a .give line (its component map)."""
    p = _SNBT(give, give.index('[') + 1)
    total = 48
    p.ws()
    while p.s[p.i] != ']':
        m = re.compile(r'[!a-z0-9_:.]+').match(p.s, p.i)
        k = m.group(0)
        p.i = m.end()
        p.ws()
        p.i += 1  # '='
        total += 32 + 36 + 2 * len(k) + _weight(p.value())
        p.ws()
        if p.s[p.i] == ',':
            p.i += 1
            p.ws()
    return total


def split_payload(plan_: dict, budget: int, text_limit: int) -> List[dict]:
    """Consecutive chunks per item, each item within `budget` weight and
    `text_limit` characters of chunk text; block-entity commands go last."""
    if budget <= 1000:
        raise ValueError('the loader leaves no room for the schematic in one item')
    parts, cur, ops, w, txt = [], [], 0, 0, 0
    for chunk, n in zip(plan_['chunks'], plan_['ops_per_chunk']):
        cw, ct = 28 + len(chunk), len(snbt_bytes(chunk)) + 2
        if cur and (w + cw > budget or txt + ct > text_limit):
            parts.append({'C': cur, 'E': [], 'ops': ops})
            cur, ops, w, txt = [], 0, 0, 0
        cur.append(chunk)
        ops += n
        w += cw
        txt += ct
    ents = plan_['E']
    ew = nbt_weight_strings(ents) - 36 if ents else 0
    if ents and cur and w + ew > budget:
        parts.append({'C': cur, 'E': [], 'ops': ops})
        cur, ops, w = [], 0, 0
    parts.append({'C': cur, 'E': list(ents), 'ops': ops + len(ents)})
    if ew > budget:
        raise ValueError('the block-entity data alone is too big for one item; try "Remove block data"')
    build = zlib.crc32(b''.join(bytes(c) for c in plan_['chunks']) + repr(plan_['T']).encode())
    for k, p in enumerate(parts, 1):
        p['payload'] = {'S': plan_['S'], 'C': p['C'], 'T': plan_['T'], 'E': p['E'], 'restore': plan_.get('restore', []),
                        'part': {'k': k, 'n': len(parts), 'id': f'{build:08x}'} if len(parts) > 1 else None}
    return parts
