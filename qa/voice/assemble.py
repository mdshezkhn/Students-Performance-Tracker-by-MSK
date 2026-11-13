# Assemble the v2 teacher video: scene webm + cloned-voice wav per take -> one mp4.
import sys, os, json, subprocess, glob, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUT = r"D:/links-personal/links-personal/web/workspace/spr-repo/qa/voice"
SC = OUT + "/scenes"
FINAL = r"D:/links-personal/links-personal/web/workspace/spr-repo/media/manual/SPR-with-Mo_Teacher-Video-Guide_v2.mp4"
DUR = json.load(open(OUT + "/take_durations.json"))
TAKES = ["01","02","03","04","05","06","07","08","09","10","11","12"]

def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: print("FFMPEG-FAIL:", " ".join(cmd[:6]), r.stderr[-800:]); sys.exit(1)

# 1) map webm files by mtime to scene order
vids = sorted(glob.glob(SC + "/*.webm"), key=os.path.getmtime)
print("found %d scene videos" % len(vids))
parts = []
for i, tid in enumerate(TAKES):
    wav = OUT + "/takes/t%s.wav" % tid
    if not os.path.exists(wav): print("missing wav", tid); sys.exit(1)
    seg = OUT + "/seg_%s.mp4" % tid
    t = DUR[tid] + 1.2
    ss = "0"
    if tid in ("01", "12"):  # card scenes come from cards.py recordings
        src = SC + "/card_%s.webm" % tid
    else:
        src = SC + "/s%s.webm" % tid
        if not os.path.exists(src): print("scene video missing:", src); sys.exit(1)
        if tid >= "04":  # journey scenes: narration matches the SETTLED tail, cut from the end
            r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", src], capture_output=True, text=True)
            d = float(r.stdout.strip().split(",")[0])
            if d > t + 0.5: ss = "%.2f" % (d - t)
    sh(["ffmpeg", "-loglevel", "error", "-y", "-ss", ss, "-i", src, "-i", wav,
        "-t", "%.2f" % t,
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,fade=t=in:st=0:d=0.35,fade=t=out:st=%.2f:d=0.4" % (t - 0.45),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest", seg])
    parts.append(seg)
    print("seg %s ok (%.1fs)" % (tid, t))

open(OUT + "/concat.txt", "w").write("".join("file '%s'\n" % p.replace("\\", "/") for p in parts))
sh(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", OUT + "/concat.txt", "-c", "copy", FINAL])
r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration,size", "-of", "csv=p=0", FINAL], capture_output=True, text=True)
print("FINAL:", FINAL, r.stdout.strip(), "bytes OK")
