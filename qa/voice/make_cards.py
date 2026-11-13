# Title + outro cards (1280x720), matching the app's paper/green look
from PIL import Image, ImageDraw, ImageFont
W,H = 1280,720
PAPER=(244,240,229); INK=(29,58,47); SOFT=(122,138,127); GOLD=(196,151,64)
def card(path, kicker, title, sub=None):
    im=Image.new("RGB",(W,H),PAPER); d=ImageDraw.Draw(im)
    d.rectangle([0,0,W,10],fill=GOLD); d.rectangle([0,H-10,W,H],fill=GOLD)
    fK=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf",30)
    fT=ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf",64)
    fS=ImageFont.truetype("C:/Windows/Fonts/georgia.ttf",30)
    def c(txt,f,y,fill):
        w=d.textlength(txt,font=f); d.text(((W-w)/2,y),txt,font=f,fill=fill)
    c(kicker,fK,220,SOFT); c(title,fT,280,INK)
    if sub: c(sub,fS,420,SOFT)
    im.save(path); print("card:",path)
card("cards/s01.png","TEACHER TRAINING","SPR with Mo","Student's Performance Report   |   training video   |   4 minutes")
card("cards/s12.png","THANK YOU","You are ready","Set up your browser, enter scores, print report cards.")
