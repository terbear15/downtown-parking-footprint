"""Checksum a lots file: line count and sum(osm_id % 1000003 + all coordinate integers)."""
import sys
for path in sys.argv[1:]:
    n = s = 0
    for line in open(path, encoding="utf-8").read().strip().split("\n"):
        n += 1
        c = line.split("|")
        s += int(c[0]) % 1000003 + sum(int(v) for v in c[5].split())
    print(path, n, s)
