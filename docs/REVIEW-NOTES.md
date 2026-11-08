# Review notes

- The Chinese notice text (source/notice.zh.html) needs a **native reader
  before go-live**. It was written for this project but has not been reviewed
  by a native speaker at the school. Do not edit the wording before that
  review; flag suggested changes to the reviewer instead.

- "Can't reach the cloud" and every other network message in the Save & Share
  hub is deliberately plain. If a message ever starts showing raw error text
  in the main view, that is a regression (raw text belongs behind Details).

## round10 (2026-11-06)

- **ZH notice needs a native read before go-live.** `source/notice.zh.html`
  gained the owner-account paragraph (学校指定的负责人账户…可以打开每一个班级…只读或锁定).
  The EN text is the source of truth; have a native-speaker colleague compare
  the two before publishing the v2 notice.
- The Users sheet shows the owner row as `Owner / All classes / protected`
  with no actions; CSV round-trips carry it and imports skip it with a note.
- Owner controls card text deliberately repeats the honest limits (offline
  devices, no deletions, public file) — keep that wording if the card is
  re-styled.
