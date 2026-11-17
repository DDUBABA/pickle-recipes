from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
image = Image.new("RGB", (1200, 630), "#f6f8ef")
draw = ImageDraw.Draw(image)
font_path = Path("C:/Windows/Fonts/malgun.ttf")
if not font_path.exists():
    raise SystemExit("Use an installed Korean font to regenerate social-card.png")
def font(size):
    return ImageFont.truetype(str(font_path), size)
draw.rounded_rectangle((65, 60, 120, 120), radius=18, fill="#315b38")
draw.text((82, 53), "p", font=font(48), fill="#e3edb7")
draw.text((140, 69), "pickle recipes", font=font(29), fill="#315b38")
draw.text((65, 188), "반복은 피클에게.", font=font(69), fill="#24382b")
draw.rounded_rectangle((60, 360, 565, 391), radius=8, fill="#dce9a8")
draw.text((65, 285), "일상은 가볍게.", font=font(69), fill="#24382b")
draw.text((68, 468), "피클 커넥터와 레시피를 찾고, 연결하고, 함께 나누세요.", font=font(25), fill="#718067")
draw.rounded_rectangle((830, 180, 1130, 310), radius=24, fill="white", outline="#dde4d3", width=2)
draw.text((867, 219), "CONNECTOR", font=font(28), fill="#315b38")
draw.line((980, 311, 980, 348), fill="#a7b793", width=3)
draw.rounded_rectangle((830, 349, 1130, 479), radius=24, fill="#315b38")
draw.text((905, 388), "RECIPE", font=font(28), fill="#e3edb7")
image.save(root / "social-card.png")
