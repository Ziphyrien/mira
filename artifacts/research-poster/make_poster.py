"""A real photograph, recoloured and typeset with Pillow/NumPy; no image generation."""
from pathlib import Path
import sys, math, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.ndimage import gaussian_filter
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / '.pi' / 'fabric' / 'poster-deps'))
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

W, H = 2400, 3200
VERSION = 'v3-brush'
PAPER = np.array([242, 237, 225], dtype=np.float32)
INK = np.array([39, 59, 119], dtype=np.float32)
RUST = (179, 85, 53)
URL = 'https://ink.zipawa.top/r/7Z5iJVqKlOI'
rng = np.random.default_rng(42017)
serif_path = str(ROOT / 'fonts' / 'NotoSerifSC.ttf')
sans_path = 'C:/Windows/Fonts/msyh.ttc'
latin_path = 'C:/Windows/Fonts/bahnschrift.ttf'

def serif(size, weight=600):
    f = ImageFont.truetype(serif_path, size)
    f.set_variation_by_axes([weight])
    return f

def sans(size): return ImageFont.truetype(sans_path, size)
def latin(size): return ImageFont.truetype(latin_path, size)

# Warm uncoated paper: broad pulp mottling + fine grain, deterministic seed.
cloud = Image.fromarray(np.uint8(rng.uniform(60, 195, (100, 75)))).resize((W,H),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(15))
cloud = (np.asarray(cloud,dtype=np.float32)-128)/34
noise = rng.normal(0,1.0,(H,W)).astype(np.float32)
texture = cloud * 1.25 + noise
paper = np.clip(PAPER[None,None,:] + texture[:,:,None],0,255).astype(np.uint8)
poster=Image.fromarray(paper)
draw=ImageDraw.Draw(poster,'RGB')
# Minute visible fibres, subtle enough to preserve readable typography.
for _ in range(17500):
    x=int(rng.integers(0,W)); y=int(rng.integers(0,H)); length=int(rng.integers(2,12))
    c=tuple(int(v) for v in np.clip(PAPER+rng.uniform(-9,-3),0,255))
    draw.line((x,y,x+length,y+int(rng.integers(-2,3))),fill=c,width=1)

# Warm material accent. Independent seed preserves the hand's exact print texture.
ys,xs=np.mgrid[0:H,0:W]
material_rng=np.random.default_rng(12038)
# Broad dry brush dragged diagonally; bristle gaps and staggered stroke ends.
angle=math.radians(-26)
dx=xs-1535;dy=ys-1840
u=dx*math.cos(angle)+dy*math.sin(angle)
v=-dx*math.sin(angle)+dy*math.cos(angle)
bins=np.arange(-800,801)
stripes=gaussian_filter(material_rng.uniform(0.15,1,len(bins)),2.2)
left=gaussian_filter(material_rng.normal(0,1,len(bins)),6)*100
right=gaussian_filter(material_rng.normal(0,1,len(bins)),5)*120
fade=np.clip(1-(np.abs(v)/470)**6,0,1)
stroke_width=650*(0.80+0.20*fade)
starts=-stroke_width+np.interp(v,bins,left)
ends=stroke_width+np.interp(v,bins,right)
edge=np.clip((u-starts)/20,0,1)*np.clip((ends-u)/65,0,1)
dry=np.interp(v,bins,stripes)
dry=np.where(dry<0.43,0.14,dry)
drag=0.90+0.10*np.sin(u/110+v/43)
mask=edge*fade*dry*drag*(0.83+cloud*0.025)
base=np.asarray(poster,dtype=np.float32)
base=base*(1-mask[:,:,None])+np.array([202,132,88],np.float32)*mask[:,:,None]
poster=Image.fromarray(np.clip(base,0,255).astype(np.uint8))

# Isolate the real photographed hands by skin/background chroma, without a model.
photo=Image.open(ROOT/'source-20805380.jpg').convert('RGB')
photo=photo.resize((1600,2405),Image.Resampling.LANCZOS)
a=np.asarray(photo,dtype=np.float32)/255
chroma=a.max(2)-a.min(2)
alpha=np.clip((chroma-0.045)/0.075,0,1)*np.clip((a[:,:,0]-a[:,:,1]-0.012)/0.035,0,1)
alpha=gaussian_filter(alpha,0.65)
lum=a[:,:,0]*0.299+a[:,:,1]*0.587+a[:,:,2]*0.114
# Lift skin highlights but keep creases and natural anatomy.
density=np.clip((0.91-lum)/0.76,0,1)**0.94
ph,pw=alpha.shape
py,px=np.mgrid[0:ph,0:pw]
angle=math.radians(22)
u=px*math.cos(angle)+py*math.sin(angle)
v=-px*math.sin(angle)+py*math.cos(angle)
cell=7.0
r=np.sqrt(((u/cell+0.5)%1-0.5)**2+((v/cell+0.5)%1-0.5)**2)
threshold=np.sqrt(np.clip(density,0,1)/math.pi)
screen=np.clip((threshold-r)*18+0.5,0,1)
ink_density=np.clip(0.78*density+0.22*screen,0,1)*alpha
# Paper-pulp abrasion: small gaps in the ink instead of uniform digital shading.
abrasion=rng.random((ph,pw))
ink_density*=np.where(abrasion<0.012,0.55,1)
# Frayed lower print edge, ending before the information footer.
edge_noise=rng.normal(0,1,pw)
cut=1975+gaussian_filter(edge_noise,9)*34+gaussian_filter(edge_noise,2)*7
ink_density*=np.clip((cut[None,:]-py)/9,0,1)
x0,y0=660,620
canvas_array=np.asarray(poster,dtype=np.float32).copy()
region=canvas_array[y0:y0+ph,x0:x0+pw]
opacity=ink_density[:,:,None]*0.99
region[:]=region*(1-opacity)+INK[None,None,:]*opacity
poster=Image.fromarray(np.clip(canvas_array,0,255).astype(np.uint8))
draw=ImageDraw.Draw(poster)
blue=tuple(INK.astype(int)); muted=(100,105,111)
boxes=[]
def text(x,y,t,font,fill=blue):
    box=draw.textbbox((x,y),t,font=font,anchor='lt')
    assert box[0]>=0 and box[2]<W and box[1]>=0 and box[3]<H,(t,box)
    draw.text((x,y),t,font=font,fill=fill,anchor='lt')
    boxes.append({'text':t,'box':box})

# Editorial hierarchy: generous margins, two decisive lines, no generic slogan.
text(143,155,'没办到时，',serif(320,740))
text(143,521,'你怎么想？',serif(320,740))
# Small rust mark links the title and the material image.
draw.rectangle((169,1050,235,1057),fill=RUST)
text(166,1110,'当别人请你做事，',serif(51,450))
text(166,1195,'而你没能办到时，',serif(51,450))
text(166,1280,'说说你当时的想法。',serif(51,450))

# Compact factual invitation details.
text(163,1660,'LET’S',latin(132),RUST)
text(161,1805,'TALK.',latin(132),RUST)
text(160,2197,'初高中生为主',serif(64,600))
text(163,2345,'约',sans(40))
text(227,2285,'9',serif(155,450))
text(342,2345,'分钟',sans(40))
text(166,2480,'真实的想法，就很好。',sans(36),muted)

# Fine photo credit outside the portrait, no implication that the model is a respondent.
text(164,2668,'PHOTO  /  VERA EMILIE · PEXELS',latin(25),muted)
draw.line((165,2735,2235,2735),fill=(131,142,161),width=2)
text(163,2815,'扫码参与访谈',serif(86,650))
text(166,2953,'自愿参与，可以跳过问题或随时结束。',sans(37))
text(166,3094,'ink.zipawa.top/r/7Z5iJVqKlOI',latin(31),muted)

# QR on an untouched paper-coloured backing, proper four-module quiet zone.
qr=qrcode.QRCode(version=None,error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=10,border=4)
qr.add_data(URL);qr.make(fit=True)
qr_image=qr.make_image(fill_color=blue,back_color=tuple(PAPER.astype(int))).convert('RGB')
qr_size=qr_image.width
poster.paste(qr_image,(2235-qr_size,2735))
text(2235-qr_size+50,2735+qr_size+8,'打开问卷',sans(28),muted)

poster.save(ROOT/f'research-poster-{VERSION}.png',dpi=(300,300),optimize=True)
preview=poster.resize((900,1200),Image.Resampling.LANCZOS)
preview.save(ROOT/f'preview-{VERSION}.jpg',quality=94,subsampling=0)
share=poster.resize((1200,1600),Image.Resampling.LANCZOS)
share.save(ROOT/f'research-poster-share-{VERSION}.jpg',quality=95,subsampling=0)
c=canvas.Canvas(str(ROOT/f'research-poster-{VERSION}.pdf'),pagesize=(576,768))
c.setTitle('没办到时，你怎么想？')
c.setAuthor('Mira research poster; photography by Vera Emilie / Pexels')
c.drawImage(ImageReader(poster),0,0,width=576,height=768)
c.linkURL(URL,(440,10,548,112),relative=0,thickness=0)
c.showPage();c.save()
# Check the embedded QR in both original and phone-sharing sizes.
import cv2
qr_results={}
for name in [f'research-poster-{VERSION}.png',f'research-poster-share-{VERSION}.jpg',f'preview-{VERSION}.jpg']:
    im=cv2.imread(str(ROOT/name));decoded,points,_=cv2.QRCodeDetector().detectAndDecode(im)
    if decoded != URL:
        found, messages, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(im)
        if found and URL in messages: decoded = URL
    qr_results[name]=decoded
    assert decoded==URL,(name,decoded)
(ROOT/f'checks-{VERSION}.json').write_text(json.dumps({'dimensions':[W,H],'qr':qr_results,'layout':boxes},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'image':[W,H],'qr':qr_results,'output':str(ROOT)},ensure_ascii=False))
