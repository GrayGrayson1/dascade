# DAS-O-Ween Trivia — presenter runbook

This guide is for whoever runs **DAS-O-Ween Trivia**, the game-show part of the remote DAS-O-Ween
party. You run it from your own laptop while you read the Teams chat. Everyone watches your shared
stage; guests who open the join link on their phone can also be **picked to answer**.

The game is DASCADE's **DAS Survey Showdown** in its **Presenter Showcase** format, with the
**DAS-O-Ween 2026** preset loaded and **your show file** holding the boards. Site:
<https://dascade.onrender.com>.

> **Watch the presenter tour** first: <https://dascade.onrender.com/tutorial/showdown> (animated, on
> practice boards). It's also a click away in the lobby and in the console (**Tour**, in the top bar).
> Opening it during the show never changes the show. Boo's Backstage Tour video still shows the
> previous console layout.

---

## The one rule: share the stage, never the console

| Window | Its title | What it shows | Share it? |
|---|---|---|---|
| **Presenter console** (your browser tab) | **🔒 PRESENTER — don't share** (lock icon, striped PRIVATE band, red frame) | Every answer, the controls, the clock | **Never.** |
| **Stage window** (a pop-up the console opens) | **DAS-O-Ween Trivia — STAGE (share this)** | The public show: the board, the host, the picks | **Yes.** In Teams, share *this window*. |

The answers are never sent to the stage window or to anyone's phone until you flip them. Sharing the
wrong window is the only way they could leak — the preflight asks a colleague to confirm what Teams shows.

---

## Before the day

### 1. Write your boards and save the show file

The real answers are **not in the app** (the old ones are public in the code's history, so the show uses
new boards). They live in a show file on your computer:

1. Open <https://dascade.onrender.com/play/showdown>, type your name, press **Create game**.
2. In **Settings → Event presets**, press **Load** next to **DAS-O-Ween 2026**. It sets the format,
   the Halloween Night look, the 10-minute clock and #5 as the special — but no boards. The lobby says
   **Now load your show file**.
3. Open **Edit your rounds** and write two Top-10 boards: the category, the question, the "According
   to …" line (keep "DAS-O-Ween Host Picks": it's a curated list, not a survey), the ten answers in
   order (▲ ▼ move them), each answer's small line, other spellings, and the special (#5).
4. Press **Save to the show**, then **Save show file** to download it (and/or **Save on this device**).
5. Keep the file **off shared drives and chats**. Give your backup presenter a copy privately.

### 2. Rehearse once (20 minutes)

1. In a fresh room, **Load** **DAS-O-Ween rehearsal (demo answers)**. It loads two practice boards
   (candy and costumes); the console and stage say **REHEARSAL**.
2. Press **Stage window** (allow pop-ups), share it in a Teams meeting with a colleague, and check the
   picture *and the sound* on the other end.
3. Have two or three people open the join link on their phones (`dascade.onrender.com/r/CODE`).
4. Press **Start game** and run a whole practice round: show the question; flip a few answers; **arm
   #5 and take it**; press **Wrong**; **pick** someone, mark them done, pick again, try **No answer**;
   pause the clock and add a minute; **Reveal remaining**; next round; **Finish show** (it's a two-step
   panel with a hold); put up **Prize time**.

---

## On the day

### 30 minutes before

1. **Freeze deploys** (ask whoever runs the repo, or run `scripts/freeze.sh on`): merges to main are
   blocked and Render's auto-deploy goes off for the event. Turn it back off afterwards.
2. Open <https://dascade.onrender.com/play/showdown> and press **Create game** (the site may take up to
   a minute to wake up). You're the presenter **and the producer**.
3. **Load** **DAS-O-Ween 2026**, then **Load your show file** (pick the file, or **Load from this
   device**) and press **Save to the show**. The lobby confirms "2 rounds from your show file".
4. **Crew & checks** (in your setup) → **Crew & log**:
   - **Your producer link** appears once — copy it somewhere private (it moves the presenter role,
     issues and revokes links).
   - Make a **Backup presenter** link for your backup and a **Moderator** link for whoever watches
     names. Send each privately (a direct message, not the event chat). They open it on their laptop.
5. Press **Stage window**. Put it on your second monitor and press its **Full screen** button (on a
   single screen, side by side with the console).
6. Under **Stage cards**, press **Welcome**.
7. Open **Preflight** (also in the console's drawer). Wait for **GO**. It checks the stage window,
   sound on the sharing device ("heard 2 s ago"), the loaded show (not the rehearsal boards), your
   backup presenter being online, the server (not freshly deployed), the black box, and asks you to
   confirm: *a colleague says Teams shows the STAGE window*, *the join link is posted*, *the freeze is on*.

### Sharing in Teams

1. In the meeting, press **Share** and turn on **Include sound**.
2. Choose **Window** → **DAS-O-Ween Trivia — STAGE (share this)**. (Never the 🔒 PRESENTER tab.)
3. Ask a colleague what they see and hear (the preflight's share check).
4. Post the join link in the chat: **dascade.onrender.com/r/CODE** (the code is on the Welcome card).

Keep the stage window open: don't minimise it, or Teams freezes on its last picture.

### Event cue sheet (60 minutes)

| Time | What's happening | What you do |
|---|---|---|
| 0–15 | Introductions, Halloween backgrounds | **Welcome** card. The DAS-O-Ween record can play from the jukebox. |
| 15–20 | Opening, then the old cartoon | **Welcome** card; for the cartoon, share the video, then the stage again. |
| 20 | The game starts | Take the card down, **Start game**. The jukebox pauses itself when a question goes live and comes back in breaks. |
| 20–32 | Round 1 | **Start round 1**, **Show the question** (the clock starts). Flip what the chat names; **Pick** someone to answer out loud; **Wrong** for misses. At 1:00 a tower bell tolls; the last ten seconds tick. Then **Reveal remaining** (hold it if the clock still runs). |
| 32–33 | Intermission | **Next round** — the pool refills for round 2. |
| 33–45 | Round 2 | The same. Then **Finish show** (two steps + hold). |
| 45–50 | Second clip | **Be right back**, or share the clip |
| 50–60 | Prizes | **Prize time**, then **Thanks for playing** |

---

## Running a round

The console never scrolls at 1280×720: the **answer sheet** on the left; the **rail** (WRONG, the clock,
Reveal remaining, Undo / Next, the **picker**); the **stage preview** over a drawer with tabs
**Picker · Sound · Cards · Fix** (plus **Names · Crew & log · Preflight** for crew). A **Next step**
line always says what to do now.

| What | Button | Key |
|---|---|---|
| Start a round / show the question | **Start round 1**, **Show the question** (starts the clock) | `Q` |
| Someone named an answer | Click it on the sheet — it flips at once | `1`–`9`, `0` = #10 |
| **The special (#5)** | A click or its key **arms** it ("Special armed"); **Take special** reveals it; Esc disarms | its key, then `Space` |
| Wrong guess | **WRONG** (as often as you like; never a strike) | `X` |
| Celebrate again | **Celebrate!** (Sound tab) | `C` |
| Clock | **Pause** / **Start**, **+1 min** / **−1 min** | `P` |
| Show what's left | **Reveal remaining** — a plain click when the clock is paused or out; **press and hold** while it still runs. Press again to stop / carry on. | `R` (hold while the clock runs; `R`/Esc stops) |
| Next round | **Next round** — acts at once, with an **Undo** for 12 seconds if answers were still hidden | `N` |
| Finish / End show | Opens a panel listing what's still hidden; **press and hold** its button (1.2 s). Keyboard: Tab to it, hold Enter. It can't be undone. | — |
| Oops | **Undo** (one step at a time) | `U` |
| Restart this round / the whole show | **Fix** tab, **press and hold** — then an Undo toast | — |

No pop-up dialogs interrupt you mid-show: reversible things act at once with an Undo; the one
irreversible thing (ending the show) takes two steps and a hold.

---

## Picking who answers

Everyone who joined on a phone is **in the pool** — except you, the crew, big screens, spectators,
anyone a moderator hid, and anyone who switched on **Skip me** (that's private: nobody can tell who
skipped; only the pool count shows).

| What | Button | Key |
|---|---|---|
| Pick someone | **Pick someone · 37 in the pool** | `K` |
| They answered | **Mark done** — out of the pool until the next round | `D` |
| They didn't | **No answer** — back in the pool, no penalty | `A` |
| No-show after 30 s | **Reroll** with a reason (No answer / Not there / Other) — draws again without them; it's logged | — |

- The server draws (fairly, with its own random generator); every screen only replays it.
- **You see the name first** ("Priya S. — on stage in 2 s"), so you can read it before the stage lands.
- The stage sweeps three spotlights over a grid of names and lands on them; their name then sits on a
  podium for the whole turn ("answering · 0:12"). Their phone says **You're up!** (and buzzes on Android);
  everyone else's says "Priya S. is answering".
- An answer you flip while someone is in the hot seat is credited on the tile: **called by Priya S.**
- Pressing Pick while someone is still up asks "Mark Priya done?" instead of drawing again.
- The pool refills when the next round starts.

---

## Guests and names

- The join link **dascade.onrender.com/r/CODE** asks for one thing: the name coworkers know you by.
  It shows a live name tag, explains they might be picked, and offers **Skip me**.
- A second "Sam" is asked to add an initial ("Sam P."), or can keep "Sam 2".
- **Moderators** (and you) open **Names**: **Rename** anyone, any time (they're told), or **Hide from
  stage** (off the spotlight grid and out of the pool; they stay in the room). Both are in the log.

---

## Sound

- **Exactly one device plays the show's sound** — the sound station. By default it's your console.
  The top bar says so: "Sound: this console ✓ heard 2 s ago". To play the sound from a big screen
  instead, open **Sound** → **Make this the sound station** next to it. If that screen drops or goes
  quiet, your console takes over within 5 seconds and tells you.
- The **Sound** tab's cue buttons play recorded sounds (applause, aww, ding, a snare drumroll, a
  "dun dun dunnn" suspense), and **Pick the Answer** plays Brian's ~10-second song — a second press while
  it plays is ignored, so it never stacks.
- Phones never play the show's sounds.
- The **jukebox** plays in breaks: it pauses itself when a question goes live and resumes on title
  cards, holding cards and the results — only if the show paused it. Room DJ is locked while the show runs.
- Do one **listening pass** through a real Teams share (laptop speakers and headphones) before the event.

---

## If something goes wrong

| Problem | What happens / what to do |
|---|---|
| Your laptop drops or you close the console | Your seat is held for **30 minutes** and the room stays alive. Open the room link again in the same browser: you're the presenter again, the show exactly where it was. |
| You can't get back | Your **backup presenter** presses **Take over the show** on their crew screen (only possible while you're offline). Or your producer link → **Make … presenter**. |
| The server restarts (a deploy or a crash) | **Don't close the console.** It holds the show's *black box*: as soon as the server is back it restores the show under the same code — board, picks, crew — silently (no sounds replay), with the clock paused (press `P`). Phones put themselves back in their seats. The stage window shows "We'll be right back" meanwhile and stays shared. |
| The stage window doesn't open | Allow pop-ups for dascade.onrender.com and press **Stage window** again. Or open the **Big-screen link** (Fix → Presenter tools) on another computer and share that. |
| No sound in Teams | Re-share with **Include sound**. Check the top bar's sound status ("✓ heard … ago"); click the console once if it says sound is locked. |
| You closed the stage window | Press **Stage window** again and re-pick it in Teams. |
| A bad name on stage | **Names** → Rename or Hide. |
| Everything failed | Create a new room, load **DAS-O-Ween 2026** and your show file, start, and use **Next round** to jump ahead. |

Shortcut keys don't work while you're typing in a text box. Click the console background first.

---

## After the show

1. Producer: **Crew & log** → **Download log (JSON)** if you want a record (it disappears with the room).
2. Turn the freeze off (`scripts/freeze.sh off`).
