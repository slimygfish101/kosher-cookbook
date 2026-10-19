import sys, glob, os
from PIL import Image, ImageOps
import pillow_heif
pillow_heif.register_heif_opener()
src, view = sys.argv[1], sys.argv[2]
for f in sorted(glob.glob(os.path.join(src, '*'))):
    b = os.path.splitext(os.path.basename(f))[0]
    im = ImageOps.exif_transpose(Image.open(f))
    exif = im.getexif()
    dt = Image.open(f).getexif().get_ifd(0x8769).get(36867) or Image.open(f).getexif().get(306)
    im = im.convert('RGB')
    full = os.path.join(view, '..', 'full', b + '.jpg')
    os.makedirs(os.path.dirname(full), exist_ok=True)
    im.save(full, quality=92)
    v = im.copy(); v.thumbnail((1600, 1600)); v.save(os.path.join(view, b + '.jpg'), quality=85)
    print(b, im.size, dt)
