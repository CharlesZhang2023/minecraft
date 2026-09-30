import sys
from PIL import Image
out = sys.argv[1]; files = sys.argv[2:]
ims = [Image.open(f).resize((640, 360)) for f in files]
cols = 2; rows = (len(ims) + 1) // 2
sheet = Image.new('RGB', (640 * cols, 360 * rows))
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * 640, (i // cols) * 360))
sheet.save(out)
