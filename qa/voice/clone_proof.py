# One-sentence clone proof: edge-tts base + OpenVoice tone-color converter with Mo's timbre.
import sys, os, subprocess, traceback
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
V = r"D:/links-personal/links-personal/web/workspace/vendor"
REF = r"D:/links-personal/links-personal/web/workspace/uploads/f859259997103b1e-Intro.mp3"
OUT = r"D:/links-personal/links-personal/web/workspace/spr-repo/qa/voice"
os.makedirs(OUT, exist_ok=True)
SENT = "Welcome to S P R, the Student's Performance Report. This short guide shows how teachers sign in for the first time."

def sh(cmd): 
    r = subprocess.run(cmd, capture_output=True, text=True, shell=False)
    if r.returncode != 0: print("SUBPROC-FAIL:", r.stderr[-600:]); sys.exit(1)

# 1) base voice via edge-tts
sh([r"D:/links-personal/links-personal/web/workspace/vendor/openvoice-env/Scripts/edge-tts.exe" if os.path.exists(r"D:/links-personal/links-personal/web/workspace/vendor/openvoice-env/Scripts/edge-tts.exe") else "edge-tts",
    "--voice", "en-US-GuyNeural", "--text", SENT, "--write-media", OUT + "/base.wav"])
print("base.wav done:", os.path.getsize(OUT + "/base.wav"), "bytes")

# 2) OpenVoice convert
sys.path.insert(0, V + "/OpenVoice")
import torch, librosa
from openvoice.api import ToneColorConverter
ck = V + "/OpenVoice/checkpoints_v2/converter"
tc = ToneColorConverter(ck + "/config.json", device="cpu")
tc.load_ckpt(ck + "/checkpoint.pth")
tgt = tc.extract_se(REF, OUT + "/se_ref.npy")
src = tc.extract_se(OUT + "/base.wav", OUT + "/se_base.npy")
tc.convert(audio_src_path=OUT + "/base.wav", src_se=src, tgt_se=tgt, output_path=OUT + "/mo_clone_test.wav", message="@SPR-mo")
import soundfile as sf
d, sr = sf.read(OUT + "/mo_clone_test.wav")
print("CLONE-OK dur=%.2fs sr=%d peak=%.3f" % (len(d) / sr, sr, abs(d).max()))
