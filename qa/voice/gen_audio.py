# SPR teacher video v2 — generate all narration takes in Mo's cloned voice.
# Pipeline: edge-tts (base) -> OpenVoice tone-color converter (Mo's timbre from Intro.mp3).
import sys, os, subprocess, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
V = r"D:/links-personal/links-personal/web/workspace/vendor"
REF = r"D:/links-personal/links-personal/web/workspace/uploads/f859259997103b1e-Intro.mp3"
OUT = r"D:/links-personal/links-personal/web/workspace/spr-repo/qa/voice"
os.makedirs(OUT + "/takes", exist_ok=True)

TAKES = [
 ("01", "Welcome to SPR with Mo - your students' performance report."),
 ("02", "This is the SPR with Mo website. Just type the address - my hyphen spr hyphen with hyphen mo, dot, duckdns, dot org - and press Enter. To begin, click the white button, Open the App. The very first time, you'll see a short privacy notice. It says your data stays inside your own browser, and that the school's owner account - that's me - can open every class, and can pause or lock the app if ever needed. Nothing is ever deleted, and nothing is sent anywhere. Have a quick read, then click, I understand."),
 ("03", "The first time on a new computer, you create your own sign-in. Click, First time using SPR - set up this browser. Choose a username - I'll use my name - and a password of at least eight characters. Next, SPR asks for a master password - a second key that can rescue your account if a password is ever forgotten. Set it, then download the recovery file it offers. That small file is the school's master key - keep it safe, with the school records. Then choose how to start: a new class, an Excel import, or the sample class. Let's load the sample."),
 ("04", "Every time you come back, just sign in with your username and password, and click, Sign In. And there's your class - welcome back!"),
 ("05", "This is the Dashboard - your whole class at a glance. The skill bars show class averages, and four tabs give you more detail. Assessment Evidence shows how complete each student's data is. Teaching Priorities tells you which skills need attention. And Advanced Analysis compares scores with progress."),
 ("06", "On the Students page you'll find your whole class. Each card shows the name, the student ID, the current grade, and a mini trend line. Use the search box to find anyone instantly."),
 ("07", "Enter Scores is where you'll spend most of your time. First pick the month, then the tab - Observations, for listening, speaking, writing and reading; Spelling, for weekly tests; Daily Assignment; and Tests, for mid-term, oral and written exams. Just type the number. There's no save button - everything saves automatically as you type."),
 ("08", "Grading is all automatic. Every component, the final percentage, and the letter grade - A star, down to U. Written counts twenty percent; everything else counts ten. And the formula is printed at the bottom of the page."),
 ("09", "Analysis compares this semester with the last one, so you can see who's improving. Click, Student Deep-Dive, pick a name, and SPR gives you charts, colour-coded progress, and an automatic SWOT - strengths, and next steps."),
 ("10", "Report Cards. Choose a student and click, View Report Card. Everything is laid out for parents, and SPR even suggests the comments for you. You can edit them, then print, or save as a PDF."),
 ("11", "Manage and Setup is home for everything else - new classes, adding students, Excel import and export. Admins also find the Users sheet here - one row per person and class, with pairing. Please download a full backup every month. And with Share and Sync, two teachers can work on the same class."),
 ("12", "And when you finish, click Sign Out - your data stays safely locked. That's SPR with Mo. I hope it makes your term a little easier!"),
]

def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: print("SUBPROC-FAIL:", r.stderr[-500:]); sys.exit(1)

sys.path.insert(0, V + "/OpenVoice")
import torch, soundfile as sf
from openvoice.api import ToneColorConverter
ck = V + "/OpenVoice/checkpoints_v2/converter"
tc = ToneColorConverter(ck + "/config.json", device="cpu")
tc.load_ckpt(ck + "/checkpoint.pth")
tgt = tc.extract_se(REF, OUT + "/se_ref.npy")

durs = {}
for tid, text in TAKES:
    base = OUT + "/takes/t" + tid + "_base.wav"
    final = OUT + "/takes/t" + tid + ".wav"
    sh([V + "/openvoice-env/Scripts/edge-tts.exe", "--voice", "en-US-GuyNeural", "--text", text, "--write-media", base])
    src = tc.extract_se(base, OUT + "/takes/se_t" + tid + ".npy")
    tc.convert(audio_src_path=base, src_se=src, tgt_se=tgt, output_path=final, message="@SPR-mo")
    d, sr = sf.read(final)
    durs[tid] = round(len(d) / sr, 2)
    os.remove(base)
    print("take %s: %.2fs" % (tid, durs[tid]))
json.dump(durs, open(OUT + "/take_durations.json", "w"), indent=1)
print("TOTAL: %.1fs" % sum(durs.values()))
