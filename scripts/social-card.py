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
draw.text((65, 151), "비공식 서드파티 커뮤니티", font=font(25), fill="#315b38")
draw.text((65, 212), "작은 자동화를", font=font(64), fill="#24382b")
draw.rounded_rectangle((60, 372, 600, 393), radius=8, fill="#dce9a8")
draw.text((65, 305), "함께 나눠요.", font=font(64), fill="#24382b")
draw.text((68, 455), "사용자가 나누는 커넥터와 레시피", font=font(25), fill="#52644b")
draw.text((68, 555), "피클 제작사와 무관하게 운영되며, 제작사의 검토·보증을 뜻하지 않습니다.", font=font(23), fill="#52644b")
draw.rounded_rectangle((830, 180, 1130, 310), radius=24, fill="white", outline="#dde4d3", width=2)
draw.text((867, 219), "CONNECTOR", font=font(28), fill="#315b38")
draw.line((980, 311, 980, 348), fill="#a7b793", width=3)
draw.rounded_rectangle((830, 349, 1130, 479), radius=24, fill="#315b38")
draw.text((905, 388), "RECIPE", font=font(28), fill="#e3edb7")
image.save(root / "social-card.png")
