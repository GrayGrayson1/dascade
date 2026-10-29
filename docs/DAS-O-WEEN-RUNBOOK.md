# DAS-O-Ween Trivia — presenter runbook

This guide is for whoever runs **DAS-O-Ween Trivia**, the game-show part of the remote DAS-O-Ween
party. You run it from your own laptop while you read the Teams chat. Everyone watches your shared
stage; guests who open the join link on their phone can also be **picked to answer**.

The game is DASCADE's **DAS Survey Showdown** in its **Presenter Showcase** format, with the
**DAS-O-Ween 2026** preset loaded and **your show file** holding the boards. Site:
<https://dascade.onrender.com>.

> **Watch the presenter tour** first: <https://dascade.onrender.com/tutorial/showdown> (animated, on
> practice boards, about 6 minutes). It's also a click away in the lobby and in the console (**Presenter
> tour**, in the top bar). Opening it during the show never changes the show. It walks through the
> Dashboard: full screen, the join QR, the picker, scenes and Cinema, standings, the finale and the
> awards. Boo's Backstage Tour video is the same tour with Boo narrating.

---

## The one rule: share the stage, never the console

| Window                                        | Its title                                                                   | What it shows                                   | Share it?                               |
| --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| **Presenter console** (your browser tab)      | **🔒 PRESENTER — don't share** (lock icon, striped PRIVATE band, red frame) | Every answer, the controls, the clock           | **Never.**                              |
| **Stage window** (a pop-up the console opens) | **DAS-O-Ween Trivia — STAGE (share this)**                                  | The public show: the board, the host, the picks | **Yes.** In Teams, share _this window_. |

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
   picture _and the sound_ on the other end.
3. Have two or three people open the join link on their phones (`dascade.onrender.com/r/CODE`).
4. Press **Start game** and run a whole practice round: show the question; flip a few answers; **arm
   #5 and take it**; press **Wrong**; **pick** someone, mark them done, pick again, try **No answer**;
   pause the clock and add a minute; **Reveal remaining**; next round; **Finish show** (it's a two-step
   panel with a hold); put up **Prize time**.
5. Try **Cinema** on the real work laptop, through the Teams share: drawer → **Cinema** → **Load
   video…**, pick the cartoon file, press `V`, then **Play**. Check the colleague hears it (see the
   Teams checklist below) and sees it play smoothly in the frame you'll use; try the seek bar and the
   10 s buttons. Then press `B` for the board.

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
5. Press **Stage window**. Put it on your second monitor, click in it and press **F** for full
   screen: that hides the window's title and address bar, so Teams shows only the stage. (Its **Full
   screen** button, top right, does the same; it shows when you move the mouse over the window. F11
   works too. **Esc** leaves full screen, F goes back.) On a single screen, keep it side by side with
   the console instead. That click also lets the stage window play video with sound later.
6. Drawer → **Cinema** → **Load video…**: pick the cartoon and the second clip (MP4, H.264 video and
   AAC sound, 1080p or smaller). They stay in this browser; nothing uploads. Choose a frame (Retro TV,
   Haunted cinema or Gilded portrait). If the console page reloads, load them again.
7. Under **Stage cards**, press **Welcome**.
8. Open **Preflight** (also in the console's drawer). Wait for **GO**. It checks the stage window,
   sound on the sharing device ("heard 2 s ago"), the loaded show (not the rehearsal boards), your
   backup presenter being online, the server (not freshly deployed), the black box, and asks you to
   confirm: _a colleague says Teams shows the STAGE window_, _the join link is posted_, _the freeze is on_.

### Sharing in Teams

1. In the meeting, press **Share** and turn on **Include sound**.
2. Choose **Window** → **DAS-O-Ween Trivia — STAGE (share this)**. (Never the 🔒 PRESENTER tab.)
3. Ask a colleague what they see and hear (the preflight's share check). If they see a browser bar
   (`about:blank`) above the stage, click the stage window and press **F**.
4. Post the join link **and its QR** in the chat: in the console's **Cards** tab (or the lobby's
   **Join QR**), press **Copy QR image** and paste it into the Teams chat, then **Copy link** and
   paste that too (**dascade.onrender.com/r/CODE**). People watching on a laptop can also scan the
   ticket on the Welcome card with their phone.

Keep the stage window open: don't minimise it, or Teams freezes on its last picture.

**Teams checklist for video sound** (try it on the real laptop before the day):

- Share with **Include sound** on (or **Share audio** mid-share).
- **Mac:** Teams needs its audio driver and the **Screen & System Audio Recording** permission
  (System Settings → Privacy & Security). On a managed Mac the driver may need IT.
- **Windows:** Teams and Windows must use the same speaker. Set Sound → **Communications** → **Do
  nothing**, so Windows doesn't turn the shared sound down.
- If the video stutters for viewers, press **Optimize** in Teams' presenter toolbar.

### The Awards desk (fill it in during the quiz)

Console drawer → **Awards** (or the results screen's **Awards**). Each award (Best Costume, Best
Background; Trivia Champions fills itself from the finale's podium) has a 1st, 2nd and 3rd: type the
name, and add a photo if you like: **paste** a Teams screenshot into the row (Ctrl/Cmd+V), **drop** a
picture on it, or press its photo button. Photos are shrunk in your browser and never uploaded; names
and photos stay in this browser (a console reload keeps them). **Nothing shows on the share until
Start.** Places with no name are skipped.

### Scenes: what the stage window shows

The scene strip above the console's preview switches the stage window; you never re-share in Teams.

| Scene      | Key | What the share shows                                                       | Phones and big-screen links              |
| ---------- | --- | -------------------------------------------------------------------------- | ---------------------------------------- |
| **Show**   | `B` | The board, exactly where you left it                                       | The board                                |
| **Cinema** | `V` | Your video in its frame (press **Play** in the Cinema tab)                 | "Cartoon break: watch the Teams share"   |
| **Awards** |     | The awards ceremony (start it in the Awards tab)                           | "Awards on stage: watch the Teams share" |
| **Cards**  |     | Opens the Cards tab: Welcome, Be right back, Standings, Prize time, Thanks | The card                                 |

Leaving the Show while the round clock runs **pauses the clock**; press `P` to start it again. The
jukebox pauses during Cinema and comes back in the next break. The Cinema tab runs the video: **Play**
/ **Pause**, back and forward **10 s**, **Restart**, and a seek bar (drag it or click it; once you've
used it, `B` still works).

### Event cue sheet (60 minutes)

| Time  | What's happening                     | What you do                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–15  | Introductions, Halloween backgrounds | **Welcome** card (it carries the big QR ticket). At 0:00 post the link and its QR in the chat. The DAS-O-Ween record can play from the jukebox.                                                                                                                                     |
| 15–20 | Opening, then the old cartoon        | **Welcome** card. For the cartoon: Cinema tab → choose the cartoon → `V` → **Play**. When it ends, `Cards` → Welcome (or `B`).                                                                                                                                                      |
| 20    | The game starts                      | Take the card down, **Start game**. The jukebox pauses itself when a question goes live and comes back in breaks.                                                                                                                                                                   |
| 20–32 | Round 1                              | **Start round 1**, **Show the question** (the clock starts). Flip what the chat names; **Pick** someone to answer out loud; **Wrong** for misses. At 1:00 a tower bell tolls; the last ten seconds tick. Then **Reveal remaining** (hold it if the clock still runs).               |
| 32–33 | Intermission                         | **Next round**. Fair mode carries on: whoever hasn't had a turn yet goes first. Latecomers: press `J` for the Join pop-up (the QR over the board for 20 s).                                                                                                                         |
| 33–45 | Round 2                              | The same. Then **Finish show** (two steps + hold).                                                                                                                                                                                                                                  |
| 45–50 | Second clip                          | Cinema tab → choose the second clip → `V` → **Play**. Then `B`.                                                                                                                                                                                                                     |
| 50–60 | Awards and prizes                    | On the results screen, **Awards** → **Start the ceremony**, then **Next** for each step: the title, each award, 3rd → 2nd → 1st (each after its drumroll), fireworks on the last winner, then **Thanks for playing**. No awards ready? **Prize time**, then **Thanks for playing**. |

---

## Running a round

The console never scrolls at 1280×720: the **answer sheet** on the left; the **rail** (WRONG, the clock,
Reveal remaining, Undo / Next, the **picker**); then the tools **Picker · Sound · Cards · Cinema · Awards ·
Fix** (plus **Guesses · Scores · Names · Crew & log · Preflight** when they apply). A **Next step** line
always says what to do now.

The bar's **Dashboard | Classic** switch picks how the tools sit; this browser remembers it.

- **Dashboard** (the default): the console fills the window and every tool is open at once, in columns
  beside the stage preview (two or three on a big screen). On a big, tall screen, Guesses, Scores and
  Crew & log sit under the answer sheet, and Fix and Names under the rail. Click a tool's title to fold
  it; the scene strip's **Cards** and **Cinema** open theirs.
- **Classic**: the previous layout, with one tabbed drawer under the stage preview.

| What                                | Button                                                                                                                                        | Key                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Start a round / show the question   | **Start round 1**, **Show the question** (starts the clock)                                                                                   | `Q`                                            |
| Someone named an answer             | Click it on the sheet — it flips at once                                                                                                      | `1`–`9`, `0` = #10                             |
| **The special (#5)**                | A click or its key **arms** it ("Special armed"); **Take special** reveals it; Esc disarms                                                    | its key, then `Space`                          |
| Wrong guess                         | **WRONG** (as often as you like; never a strike)                                                                                              | `X`                                            |
| Celebrate again                     | **Celebrate!** (Sound tab)                                                                                                                    | `C`                                            |
| Clock                               | **Pause** / **Start**, **+1 min** / **−1 min**                                                                                                | `P`                                            |
| Show what's left                    | **Reveal remaining** — a plain click when the clock is paused or out; **press and hold** while it still runs. Press again to stop / carry on. | `R` (hold while the clock runs; `R`/Esc stops) |
| Next round                          | **Next round** — acts at once, with an **Undo** for 12 seconds if answers were still hidden                                                   | `N`                                            |
| Finish / End show                   | Opens a panel listing what's still hidden; **press and hold** its button (1.2 s). Keyboard: Tab to it, hold Enter. It can't be undone.        | —                                              |
| Oops                                | **Undo** (one step at a time)                                                                                                                 | `U`                                            |
| Restart this round / the whole show | **Fix** tab, **press and hold** — then an Undo toast                                                                                          | —                                              |

No pop-up dialogs interrupt you mid-show: reversible things act at once with an Undo; the one
irreversible thing (ending the show) takes two steps and a hold.

---

## Picking who answers

Everyone who joined on a phone is **in the random draw** — except you, big screens, spectators, anyone
a moderator hid, anyone you or the crew **excluded**, and anyone who switched on **Skip me** (that's
private: nobody can tell who skipped, not even you; only the pool count shows). Crew are in the random
draw only if **Crew in the random draw** is on in the setup (off for DAS-O-Ween).

**Two modes** (setup → **Picker**):

- **Fair mode** (DAS-O-Ween's): fewest turns first. Everyone gets a turn before anyone gets a second
  one; once everyone has had one, the next lap opens by itself. Turns count for the whole show.
- **True random**: anyone in the draw, every time — a finished turn doesn't take you out — but never
  the same person twice in a row.

| What                                         | Button                                                                                                                                                                                                            | Key |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Pick someone                                 | **Pick someone · 37 in the pool**                                                                                                                                                                                 | `K` |
| Pick a particular person                     | **Spotlight…** next to Pick: type a name, Enter. Works on anyone seated — even if they've had a turn, are excluded, have Skip me on, or are crew. Never you, a big screen or a spectator. (You and the producer.) | `F` |
| They answered                                | **Mark done** — counts their turn                                                                                                                                                                                 | `D` |
| They didn't                                  | **No answer** — no turn counted, no penalty                                                                                                                                                                       | `A` |
| No-show after 30 s                           | **Reroll** with a reason (No answer / Not there / Other) — draws again without them; it's logged                                                                                                                  | —   |
| Take someone out of the draw / put them back | **Picker** tab → **Exclude** / **Include** next to their name, or **Include everyone**. You and every crew member, any time (lobby too).                                                                          | —   |

- The server draws (fairly, with its own random generator); every screen only replays it.
- **You see the name first** ("Priya S. — on stage in 2 s"), so you can read it before the stage lands.
- The stage sweeps three spotlights over a grid of names and lands on them; their name then sits on a
  podium for the whole turn ("answering · 0:12"). Their phone says **You're up!** (and buzzes on Android);
  everyone else's says "Priya S. is answering".
- An answer you flip while someone is in the hot seat is credited on the tile: **called by Priya S.**
- Pressing Pick while someone is still up asks "Mark Priya done?" instead of drawing again.
- The **Picker** tab lists everyone with their turns this show, who's excluded, who's crew and who's
  done this round. If nobody is in the draw, the rail says why and offers **Include everyone** — and
  **Spotlight…** always works.
- Phones say where people stand: in the pool, "You've had a turn — you're back in once everyone has
  had one", "out of the random draw" (excluded or Skip me), always with "The presenter can still call
  you up by name". Crew see the same card on their crew screen.

---

## Scores and medals (two tiers that never touch)

DAS-O-Ween scores the crowd and gives the hot seat medals (setup → **Scoring**; all of it can be
switched off there — **Score the crowd** off runs the show exactly as before).

- **The crowd** fills a private **Top 10** on their phone (or laptop): one guess per spot, up to 10.
  When an answer flips — however it was found — everyone who had it scores **#1 = 10 … #10 = 1**, **+1**
  if it was in the same spot, **+20** for a perfect list. Answers only **Reveal remaining** found
  (hidden gems) pay double. Phones show their own points and rank privately.
- **The hot seat** earns medals for answers flipped during their turn: 🥇 #1–#3, 🥈 #4–#7, 🥉 #8–#10,
  🎃 for #5 (the special), and a 🎗️ Brave ribbon for a turn with no find. A medal pins on as the tile
  flips. **Wrong credit** (someone in the chat named it mid-turn)? **Scores** tab → **Remove** next to it.
- **Between rounds**: when the board is complete, **Show standings** puts the top five (and, with
  medals after each round, the Spotlight Stars) on the stage: points on the left, medals on the
  right, and a legend underneath that says what each medal and the points mean. Take it down like any
  card.
- **The finale**: on the results screen, step through it — the medal ceremony, then 3rd, 2nd, 1st —
  each with its drumroll and applause. Then **Prize time** lists the winners.
- **Download** the scores any time (**Scores** tab, or the results screen): CSV for a spreadsheet, JSON
  for the full record. It never contains an answer that hasn't flipped.
- **Later, not built yet:** a scorekeeper crediting answers given in the chat or out loud to the
  person who said them. Until then, chat and spoken answers count for the hot seat's medals only when
  they're flipped during that person's turn.

## Guests and names

- The join link **dascade.onrender.com/r/CODE** asks for one thing: the name coworkers know you by.
  It shows a live name tag, explains they might be picked, and offers **Skip me**.
- A second "Sam" is asked to add an initial ("Sam P."), or can keep "Sam 2".
- **Moderators** (and you) open **Names**: **Rename** anyone, any time (they're told), or **Hide from
  stage** (off the spotlight grid and out of the pool; they stay in the room). Both are in the log.
- Moderators and backup presenters also get the **Picker** tab on their crew screen (phone or laptop:
  the same screen): **Exclude** / **Include** anyone, any time. Spotlight a name is yours and the
  producer's.

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

| Problem                                      | What happens / what to do                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your laptop drops or you close the console   | Your seat is held for **30 minutes** and the room stays alive. Open the room link again in the same browser: you're the presenter again, the show exactly where it was.                                                                                                                                                                         |
| You can't get back                           | Your **backup presenter** presses **Take over the show** on their crew screen (only possible while you're offline). Or your producer link → **Make … presenter**.                                                                                                                                                                               |
| The server restarts (a deploy or a crash)    | **Don't close the console.** It holds the show's _black box_: as soon as the server is back it restores the show under the same code — board, picks, crew — silently (no sounds replay), with the clock paused (press `P`). Phones put themselves back in their seats. The stage window shows "We'll be right back" meanwhile and stays shared. |
| The stage window doesn't open                | Allow pop-ups for dascade.onrender.com and press **Stage window** again. Or open the **Big-screen link** (Fix → Presenter tools) on another computer and share that.                                                                                                                                                                            |
| No sound in Teams                            | Re-share with **Include sound**. Check the top bar's sound status ("✓ heard … ago"); click the console once if it says sound is locked.                                                                                                                                                                                                         |
| You closed the stage window                  | Press **Stage window** again and re-pick it in Teams. Cinema: press **Play** again (the video starts over).                                                                                                                                                                                                                                     |
| **Play** says the stage window needs a click | Click anywhere in the stage window once: the video starts. (Browsers allow sound only after a click there; the Full screen button counts.)                                                                                                                                                                                                      |
| Teams shows a browser bar above the stage    | Click the stage window and press **F** (or move the mouse over it and press **Full screen**, top right — it works during Cinema too). Esc leaves full screen; the show carries on either way.                                                                                                                                                   |
| The video won't play                         | Use an MP4 (H.264 video, AAC sound). Fallback: **Be right back**, then share the video player with Include sound, then share the stage again.                                                                                                                                                                                                   |
| The connection drops during the video        | The video keeps playing in the stage window; the show comes back under it.                                                                                                                                                                                                                                                                      |
| A bad name on stage                          | **Names** → Rename or Hide.                                                                                                                                                                                                                                                                                                                     |
| Everything failed                            | Create a new room, load **DAS-O-Ween 2026** and your show file, start, and use **Next round** to jump ahead.                                                                                                                                                                                                                                    |

Shortcut keys don't work while you're typing in a text box. Click the console background first.

---

## After the show

1. Producer: **Crew & log** → **Download log (JSON)** if you want a record (it disappears with the room).
2. Turn the freeze off (`scripts/freeze.sh off`).
