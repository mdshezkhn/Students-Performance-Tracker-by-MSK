# Finalize: rename scene videos by recording order, record card scenes, verify, assemble.
import os, sys, glob, subprocess
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUT = os.path.abspath("scenes")

def sh(*a):
    print("+", " ".join(a)); r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode: print(r.stdout[-600:], r.stderr[-600:])
    return r.returncode

vids = sorted(glob.glob(OUT + "/page@*.webm"), key=os.path.getmtime)
assert len(vids) == 10, "expected 10 scene videos, got %d" % len(vids)
for i, v in enumerate(vids):
    sid = i + 2                                     # scenes 02..11
    dst = OUT + ("/s%s.webm" % ("%02d" % sid))
    if os.path.exists(dst): os.remove(dst)
    os.rename(v, dst)
    d = sh("ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", dst).strip()
    print("s%s <= %s (%ss)" % ("%02d" % sid, os.path.basename(v), d))
print("RENAME-DONE")
