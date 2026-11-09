"""Render the geometric DormStore brand to PNG/ICO using only Python's standard library."""
import pathlib
import struct
import zlib

size = 256
scale = 3

def pixel(x, y):
    # Rounded evergreen tile with a white storefront.
    r = 48
    dx, dy = max(r - x, 0, x - (256 - r)), max(r - y, 0, y - (256 - r))
    if dx * dx + dy * dy > r * r:
        return (0, 0, 0, 0)
    color = (23, 104, 78, 255)
    if 61 <= x <= 195 and 112 <= y <= 198:
        color = (245, 250, 246, 255)
    if 53 <= y <= 66 and 74 <= x <= 182:
        color = (245, 250, 246, 255)
    if 70 <= y <= 112 and 73 - (y - 70) * .48 <= x <= 183 + (y - 70) * .48:
        color = (245, 250, 246, 255)
    if 78 <= x <= 113 and 139 <= y <= 174:
        color = (23, 104, 78, 255)
    if 136 <= x <= 176 and 139 <= y <= 198:
        color = (23, 104, 78, 255)
    if 49 <= x <= 207 and 198 <= y <= 210:
        color = (245, 250, 246, 255)
    return color

raw = bytearray()
for y in range(size):
    raw.append(0)
    for x in range(size):
        samples = [pixel(x + (sx + .5) / scale, y + (sy + .5) / scale) for sy in range(scale) for sx in range(scale)]
        raw.extend(round(sum(p[c] for p in samples) / len(samples)) for c in range(4))

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
folder = pathlib.Path(__file__).resolve().parent.parent / 'build'
folder.mkdir(exist_ok=True)
(folder / 'icon.png').write_bytes(png)
(folder / 'icon.ico').write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22) + png)
print('Created build/icon.png and build/icon.ico')
