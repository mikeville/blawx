import io, struct, sys
from PIL import Image

cap = int(sys.argv[1])
data = sys.stdin.buffer.read()
with Image.open(io.BytesIO(data)) as image:
    if image.width * image.height > cap:
        raise ValueError("texture pixel cap exceeded")
    image.load()
    rgba = image.convert("RGBA")
    sys.stdout.buffer.write(struct.pack("<II", rgba.width, rgba.height))
    sys.stdout.buffer.write(rgba.tobytes())
