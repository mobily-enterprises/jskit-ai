Here's how I'd run a final sweep in three steps: I do a systematic pass on my own first, then a short session with you for the parts that need you, then I tidy up.

**Step 1: I sweep on my own (no need for you)**
- **Click everything.** I go through every visible control and compare it against the specs: every button, the + menu, every right-click menu (bots, messages, sections, Library items), every keyboard shortcut on the shortcuts sheet, and every settings row. Anything with no spec is a gap.
- **Gather the "unverified" lists.** Every spec has one, and I'll merge them all into a single gap list. Each item gets labelled as one of three kinds:
  - **I can observe it now:** for example, editing and deleting pages, or a bot made from a template.
  - **Needs you:** real accounts, audio, a second account, payment, your phone, links that open in a browser.
  - **Can't be observed at all.**
- **Output:** one gap list, saved to your Session Dropzone, with every item marked done, observable, needs you, or impossible.

**Step 2: a session with you, for the "needs you" items and things only you know about**
- **You drive the reference over VNC**, using it as you normally would: your knowledge of features, the test Google account, the phone app, links opening in your browser.
- **I record the screen** at a low frame rate while you work, and capture stills when you tell me something interesting is happening. Just tell me what you did in plain words ("now I'm connecting Gmail", "this is the share link in my browser").
- **Things outside the reference machine:** put screenshots in the Session Dropzone, for example from the mobile app, the help pages, or emails it sends. I'll file them.
- **What I need from you:**
  - which features you know or suspect exist that I haven't covered (I'll ask about specific suspects from my list)
  - the test Google account, so I can see the real connected states
  - your call on anything that sends real data or costs money

**Step 3: I tidy up**
- **For mercbot:**
  - Newly discovered areas go to mercbot as additions to the feature map.
  - Each one gets a spec, sent when you or mercbot ask for it. The phase-2 rules allow that.
- **For you:** a final coverage summary.

**One thing to keep in mind:** you'll see more of the original than mercbot ever should. During this phase, keep sending findings through me rather than straight to mercbot.

[1] Shall I start Step 1 (the solo sweep and gap list) now?
Possible answers:
- Yes, start now
- Wait until I'm ready to do Step 2 as well

[2] For Step 2, how would you like to work?
Possible answers:
- I drive over VNC while you record
- I'll put screenshots in the Dropzone
- A mix of both