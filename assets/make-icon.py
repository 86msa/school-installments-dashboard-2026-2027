from PIL import Image, ImageDraw

size = 512
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((18, 18, 494, 494), radius=112, fill=(22, 105, 75, 255))
draw.rounded_rectangle((55, 55, 457, 457), radius=83, outline=(223, 246, 230, 150), width=6)
draw.polygon([(110, 157), (248, 177), (248, 361), (110, 341)], fill=(255, 255, 255, 255))
draw.polygon([(264, 177), (402, 157), (402, 341), (264, 361)], fill=(235, 250, 239, 255))
draw.line([(256, 174), (256, 365)], fill=(25, 115, 80, 255), width=12)
for y, width in [(230, 87), (267, 105), (304, 74)]:
    draw.rounded_rectangle((129, y, 129 + width, y + 11), radius=5, fill=(59, 145, 104, 255))
for y, width in [(222, 87), (259, 105), (296, 74)]:
    draw.rounded_rectangle((281, y, 281 + width, y + 11), radius=5, fill=(59, 145, 104, 255))
image.save('assets/icon.png')
image.save('assets/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
