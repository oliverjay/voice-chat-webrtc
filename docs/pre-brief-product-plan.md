# Pre-Brief: Product, UX & Engineering Plan

## 1. Product Framing

**One sentence:** VC lets you record short video/audio updates into a timeline attached to any meeting so attendees arrive already briefed.

**How it differs:** A normal meeting app is synchronous — everyone must be live at the same time. Pre-Brief adds an asynchronous layer *before* the live call: short recorded clips that prepare attendees, reduce meeting time, and work across time zones.

**Why it's a minimal-change extension, not a new product:**
- A meeting room already exists (`/{roomId}`)
- Recording is just `getUserMedia` → `MediaRecorder` → upload (reuses existing media stack)
- The pre-join screen (`/{roomId}`) already shows who's in the room — adding "who's watched" is the same pattern
- Clips are just media files associated with a room, not a new architecture
- The live call is untouched

**Smallest believable MVP:**
- Host opens meeting page → taps "Add a clip" → records 30s–3min of webcam/audio → clip appears in a timeline on the meeting page
- Invitees open the same meeting link → see the timeline before joining → watch clips
- Host sees watched/not-watched status on the pre-join screen
- Live call works exactly as before

---

## 2. Minimal-Change Strategy

### Existing surfaces to reuse

| Existing Surface | Reuse For Pre-Brief |
|---|---|
| **Meeting page** (`/[room]`) | Add pre-brief timeline module above the "Ready to join?" form |
| **Pre-join screen** (`/[room]`) | Show watched/not-watched status for each participant (extends peek) |
| **`getUserMedia` + MediaRecorder** | Recording clips (same camera/mic the user already granted permission for) |
| **Chat sidebar** (`ChatPanel`) | Pattern for the clip timeline UI (vertical scrollable list, similar layout) |
| **Room WebSocket + DO** | Broadcast "new clip added" and "participant watched" events in real-time |
| **Participant model** | Extend with `viewStatus` field |
| **Invite link / share URL** | Same link serves both pre-brief viewing and live meeting joining |

### Where the feature lives (no disruption)

```
/{roomId}                     ← Pre-join page (EXISTING)
  ├─ Pre-Brief Timeline       ← NEW module: sits above device controls
  │   ├─ Clip cards (watch)
  │   └─ "Add clip" button (host only)
  ├─ Device controls           ← UNCHANGED
  ├─ Name + Join button        ← UNCHANGED
  └─ Participant readiness     ← EXTENDED: shows watched status

/{roomId}/call                ← Live call (UNCHANGED)
  └─ Optional: small "Pre-brief" button in ControlBar
      opens a read-only reference drawer

/{roomId}/record              ← NEW route: record clip (modal-feel fullscreen)
```

**Key principle:** One URL (`/{roomId}`) serves both pre-brief consumption and meeting join. No separate "pre-brief page." The meeting *is* the pre-brief landing page.

---

## 3. UX Plan

### Creating a pre-brief
The host visits `/{roomId}` (the normal pre-join page). A new section appears: "Pre-Brief" with an "Add a clip" button. This is visible only to the meeting creator/host. Tapping it navigates to `/{roomId}/record` — a focused recording screen.

### Recording a clip
Full-screen recording view. Camera preview (reusing existing `VideoTile`), a prominent Record button, a visible timer counting up. Max 3 minutes. Tap stop → preview playback → "Save" or "Re-record." On save: upload to storage, clip appears in timeline. User returns to the pre-join page.

### How clips appear
On the pre-join page, the Pre-Brief section shows clips in chronological order. Each clip card shows: host avatar/name, duration, title (optional, auto-generated from order: "Update 1", "Update 2"), and a play button. Clicking plays inline with a simple video player. Progress is tracked.

### How invitees consume
Invitee opens the meeting link → sees the pre-brief timeline at the top of the pre-join page → watches clips → then configures devices and joins as normal. No extra steps. The timeline is simply *there*, above the join form.

### Watched status
- **Watched** — green check, "Watched"
- **Partially watched** — yellow dot, "Partially watched" (watched some clips but not all)
- **Not watched** — grey, "Not yet watched"

This status is visible to the host on the pre-join page next to each participant's peek avatar.

### Host readiness view
On the pre-join page, below the participant peek section, the host sees a readiness summary: "2 of 3 invitees watched the pre-brief" with individual status per person.

### Desktop vs Mobile
- **Desktop:** Timeline appears in the left column of the existing 2-column pre-join grid (replaces or sits above the camera preview). Record flow is the same route but wider layout.
- **Mobile:** Timeline appears above the camera preview in the single-column stack. Record flow is fullscreen (same as camera preview, which already works).

### Consistency with meetings product
- Same rounded cards, same glass/surface colors, same typography
- Clip cards look like chat message bubbles (already established pattern)
- Record button uses the existing `shiny-cta` style
- No new navigation paradigm — everything lives at the meeting URL

---

## 4. Key Screens

### 4a. Meeting Details Page with Pre-Brief Module

**Purpose:** The pre-join page now doubles as the pre-brief consumption and creation surface.

**Hierarchy:**
1. Pre-Brief Timeline (new, top of left column on desktop / top of page on mobile)
2. Camera Preview + Device Controls (existing)
3. Name + Join Call (existing)
4. Participant Readiness (extended)

**Main components:**
- `PreBriefTimeline` — scrollable list of `ClipCard` components
- `ClipCard` — avatar, name, title, duration badge, play button, inline player
- "Add a clip" button (host only) — navigates to `/{roomId}/record`

**Primary CTA:** "Join call" (unchanged). Secondary: "Add a clip" (host) or "Watch" (invitee on first clip).

**Empty state:** "No pre-brief yet. Add a short update to prepare attendees." (host) / "No pre-brief for this meeting." (invitee)

**Edge cases:**
- Host hasn't recorded yet → empty state with clear CTA
- Meeting link opened after meeting already started → timeline still visible, can watch and then join late
- Very long timeline (5+ clips) → scrollable with clip count indicator

### 4b. Record Clip Screen (`/{roomId}/record`)

**Purpose:** Focused recording experience. No distractions.

**Hierarchy:**
1. Camera preview (large, filling most of screen)
2. Recording controls (bottom)
3. Title input (optional, post-recording)

**Main components:**
- `VideoTile` (reused, mirror mode, large)
- Record button (red circle, pulses when recording)
- Timer (counts up, max 3:00)
- Stop → Preview → Save/Re-record flow
- Optional title input after recording

**Primary CTA:** Record (pre) → Stop (during) → Save (post)

**Empty state:** N/A — this screen only appears when actively recording.

**Edge cases:**
- Camera permission denied → show error, link back to pre-join
- Recording exceeds 3 min → auto-stop with message
- Browser doesn't support MediaRecorder → fallback message
- Network drops during upload → retry with progress indicator

### 4c. Invitee Pre-Join Page with Timeline

**Purpose:** Invitee lands here from the meeting link. Watches pre-brief, then joins.

**Hierarchy:**
1. Pre-Brief Timeline (if clips exist)
2. "Ready to join?" heading + participant peek
3. Device controls
4. Join button

**Main components:** Same as 4a but without "Add a clip" button. Each clip shows a play state (unwatched / playing / watched). A subtle progress bar across the top shows overall completion ("2 of 3 clips watched").

**Primary CTA:** "Join call"

**Edge cases:**
- Invitee skips clips → joins anyway (no blocking)
- Clips still uploading → show placeholder "Processing…"
- Invitee on slow connection → audio-only fallback option on clips

### 4d. Host Pre-Join Page with Readiness Info

**Purpose:** Host sees who watched before joining.

**Hierarchy:**
1. Pre-Brief Timeline (own clips, with edit/delete options)
2. Participant Readiness Summary
3. Device controls + Join

**Main components:**
- Readiness bar: "3/5 watched" with avatars and status dots
- Per-participant detail: name, status (watched/partial/none), last active
- "Add another clip" button

**Primary CTA:** "Join call"

**Edge cases:**
- No invitees have opened the link yet → "No one has viewed the pre-brief yet"
- All watched → "Everyone is prepared" (green)

### 4e. In-Meeting Pre-Brief Reference

**Purpose:** Lightweight access to clips during the call.

**Hierarchy:** Small "Pre-brief" icon button in `ControlBar` (next to chat). Opens a read-only drawer (similar to `ChatPanel`) showing clip titles and readiness status.

**Main components:** Clip list (title + duration + who watched), no inline playback during call (too heavy).

**Primary CTA:** None — reference only.

**Edge cases:**
- No pre-brief exists → button hidden
- Pre-brief with many clips → scrollable list

---

## 5. User Flows

### Flow A: Host creates meeting and adds a pre-brief
1. Host visits `/` → "Start a call" → redirected to `/{roomId}`
2. Pre-join page loads with empty Pre-Brief section
3. Host taps "Add a clip"
4. Navigated to `/{roomId}/record`
5. Camera preview loads (permissions already granted from pre-join init)
6. Host taps Record → speaks for 45 seconds → taps Stop
7. Preview plays back → Host taps "Save"
8. Clip uploads → redirect back to `/{roomId}`
9. Timeline now shows one clip card
10. Host copies invite link (existing flow) and shares with invitees

### Flow B: Host records multiple clips
1. After saving first clip, host taps "Add another clip"
2. Same record flow → saves second clip
3. Timeline now shows two clips in order
4. Host can reorder by drag (v1.5) or delete by swiping/long-press

### Flow C: Invitee receives reminder and watches
1. Invitee receives link (via chat, email, etc. — outside the app)
2. Opens `/{roomId}` in browser
3. Pre-join page loads → Pre-Brief Timeline visible at top
4. Invitee taps play on first clip → watches inline
5. First clip marked as "watched" → progress updates
6. Invitee watches second clip
7. "All caught up" message appears
8. Invitee enters name, configures devices, joins call

### Flow D: Host checks readiness
1. Host returns to `/{roomId}` before the scheduled time
2. Participant peek section shows: "Alice — Watched ✓", "Bob — Not yet watched"
3. Host sees "1 of 2 prepared"
4. Host can wait or join

### Flow E: Meeting starts normally
1. Host taps "Join call" → `/{roomId}/call`
2. Live meeting proceeds exactly as before
3. Optional: ControlBar shows small "Pre-brief" reference button
4. Tapping it shows a read-only clip list + readiness in a drawer

### Flow F: Async-only (pre-brief replaces meeting)
1. Host records clips but decides a live call isn't needed
2. Host sends link with message: "Watch the pre-brief, no need to meet live"
3. Invitees watch clips at their convenience
4. Host sees everyone has watched
5. No live call happens — the pre-brief was sufficient
6. (v1.5: host can add a "No live call needed" flag that hides the Join button)

---

## 6. Feature Scope

### V1 Must-Have
- [ ] Record a clip (webcam + mic, up to 3 min)
- [ ] Upload clip to storage (Cloudflare R2 or S3)
- [ ] Display timeline on pre-join page
- [ ] Inline playback of clips
- [ ] Track watched/not-watched per participant
- [ ] Show readiness status to host on pre-join
- [ ] Real-time "clip added" broadcast via existing WebSocket

### V1.5 Nice-to-Have
- [ ] Audio-only clips (no camera)
- [ ] Optional clip titles
- [ ] Reorder / delete clips
- [ ] "No live call needed" async mode flag
- [ ] Pre-brief reference drawer in-call
- [ ] Email/push notification when pre-brief is added
- [ ] Clip thumbnails (generated server-side)

### Later
- [ ] Threaded replies on clips (discussion before meeting)
- [ ] AI-generated summary of all clips
- [ ] Transcript / captions on clips
- [ ] Scheduled auto-reminders
- [ ] Analytics dashboard (watch rates, meeting duration reduction)
- [ ] Screen recording clips (not just webcam)
- [ ] Clip annotations / timestamps

---

## 7. Engineering Plan

### New data storage
Since the current app is stateless (rooms exist only while the Durable Object is alive), pre-briefs need persistent storage. Two options:

**Option A (Recommended for V1): Durable Object storage**
- Use the existing `Room` DO's `ctx.storage` to persist clips metadata
- Store actual media files in Cloudflare R2 (or presigned S3 uploads from client)
- Clips survive DO hibernation via `ctx.storage`

**Option B (Later): External database**
- Add a D1 or Postgres database for meetings/clips/view-status
- Better for analytics, querying, retention policies

### New API endpoints (SvelteKit `app/src/routes/api/`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/clips` | `POST` | Upload a clip (multipart: video file + metadata) |
| `/api/clips` | `GET` | List clips for a room (`?room=xyz`) |
| `/api/clips/[id]` | `DELETE` | Delete a clip (host only) |
| `/api/clips/[id]/watched` | `POST` | Mark clip as watched by participant |
| `/api/clips/upload-url` | `POST` | Get presigned R2 upload URL (for large files) |

### Recording system
No server-side recording needed. The client uses `MediaRecorder` API:
1. `getUserMedia` → `MediaRecorder` → `Blob` chunks
2. On stop: combine chunks → `Blob` → upload via presigned URL or POST
3. Format: WebM (VP8/VP9 + Opus) — native browser output, no transcoding needed for V1

### Storage model
```
R2 Bucket: vc-clips
  /{roomId}/{clipId}.webm     ← video file
  /{roomId}/{clipId}.jpg      ← thumbnail (v1.5)
```

Metadata stored in DO `ctx.storage` under key `clips`:
```json
[
  { "id": "abc", "authorId": "...", "authorName": "Oli", "duration": 47, "createdAt": "...", "title": "Update 1" }
]
```

### Playback / view tracking
- Client fetches clip list from API → renders timeline
- Playback: `<video src="R2_URL">` with `timeupdate` event listener
- When >80% of a clip is watched → POST `/api/clips/[id]/watched`
- View status stored in DO `ctx.storage` under key `viewStatus`:
```json
{ "clipId:participantId": { "watched": true, "watchedAt": "...", "progress": 0.95 } }
```

### Permissions / access model
- Clips are readable by anyone with the room URL (same as joining a call — link-based access)
- Only the clip author can delete their own clips
- Host (first person to record a clip) gets readiness view
- No auth system needed for V1 (matches current app: no accounts)

### Meeting linkage
Clips are stored per `roomId`. The room URL *is* the meeting. No separate meeting entity needed for V1.

### WebSocket extensions
Add two new message types to `protocol.ts`:

```typescript
// Client → Server
{ type: 'clip-added', clip: ClipMeta }

// Server → Client  
{ type: 'clip-added', clip: ClipMeta }
{ type: 'clip-watched', clipId: string, participantName: string }
```

The DO broadcasts these to all connected WebSocket clients (same pattern as `chat-message`).

### Migration / rollout
- No migration needed — rooms are ephemeral
- Feature is purely additive: old rooms without clips just show empty state
- Ship behind a feature flag if desired (check `room.clips.length > 0` to show/hide timeline)

---

## 8. Data Model

```typescript
interface Meeting {
  roomId: string;           // Already exists (URL param)
  // No changes needed — the room IS the meeting
}

interface PreBriefClip {
  id: string;               // UUID
  roomId: string;           // Links to meeting
  authorId: string;         // clientId from preferences
  authorName: string;       // Display name
  title: string;            // "Update 1" (auto or manual)
  duration: number;         // Seconds
  mediaUrl: string;         // R2 URL
  mediaType: 'video' | 'audio';
  createdAt: string;        // ISO timestamp
  order: number;            // Position in timeline
}

interface ParticipantViewStatus {
  clipId: string;
  participantId: string;    // clientId
  participantName: string;
  watched: boolean;         // True if >80% viewed
  progress: number;         // 0.0 to 1.0
  watchedAt: string | null; // ISO timestamp
}

// Stored in DO ctx.storage:
// "clips" → PreBriefClip[]
// "viewStatus" → ParticipantViewStatus[]

// Optional v1.5:
interface TopicMarker {
  id: string;
  clipId: string;
  timestamp: number;        // Seconds into clip
  label: string;            // "Budget discussion"
}
```

---

## 9. Permissions and Edge Cases

| Scenario | Behavior |
|---|---|
| **Who can create clips** | Anyone with the room URL (V1). Practically, the host shares the link and records first. |
| **Who can delete clips** | Only the author of that clip |
| **Who can view clips** | Anyone with the room URL |
| **External clients vs internal** | No distinction — link-based access (same as current calls) |
| **Invitee joins without watching** | Allowed. No blocking. Host sees "Not watched" status. |
| **Clips uploaded late** (after some invitees already joined) | Real-time broadcast via WebSocket. Late clips appear in timeline. Invitees on pre-join page see them immediately. |
| **Instant / unscheduled meeting** | Pre-brief section shows empty state. Host can still record clips ad-hoc. |
| **Privacy** | Clips are accessible only via room URL (unguessable slug). Same security model as the call itself. |
| **Retention** | V1: clips persist as long as R2 objects exist. V1.5: auto-delete after 30 days. |
| **Pre-brief unavailable** (R2 down, clips fail to load) | Timeline shows "Couldn't load pre-brief" message. Join flow unaffected. |
| **Browser doesn't support MediaRecorder** | "Add a clip" button hidden. Clips can still be viewed (just `<video>` playback). |

---

## 10. Notifications and Lifecycle

### Minimal lifecycle

```
1. Meeting created          → Room URL exists
2. Pre-brief added          → Host records first clip
3. Clip broadcast           → WebSocket pushes to any connected clients
4. Link shared              → Host shares URL (existing copy flow)
5. Invitee opens link       → Sees timeline, watches clips
6. Watched status updated   → Real-time via WebSocket
7. Meeting starts           → Normal live call
8. Post-meeting             → Clips remain accessible at URL
9. Retention (v1.5)         → Auto-delete after 30 days
```

### Notification model (V1: zero notifications)
V1 has no notification system (the current app doesn't either). The host shares the link manually.

### V1.5 notifications
- When a pre-brief is added: optional email/SMS to invitees
- 1 hour before meeting: "Oli shared a pre-brief for your call — watch before joining"
- Keep it to max 1 notification per meeting per person

---

## 11. Metrics

### Success metrics
| Metric | What it measures | Target |
|---|---|---|
| Pre-brief creation rate | % of meetings with at least 1 clip | >15% of meetings |
| Watch completion rate | % of invitees who watch all clips | >60% |
| Prepared attendee rate | % of participants who watched before joining | >50% |
| Meeting duration delta | Avg duration of meetings with pre-brief vs without | 15-25% shorter |
| Clips per pre-brief | Avg clips recorded per meeting | 1.5-3 |
| Return usage | % of hosts who use pre-brief in next meeting | >40% |

### Leading indicators for PMF
- Hosts recording clips for >2 meetings (repeat behavior)
- Invitees watching clips unprompted (not just because host asked)
- Meetings being cancelled/shortened because pre-brief was sufficient
- Users sharing feedback like "this saved us the meeting"

---

## 12. Copy

### Feature name options
1. **Pre-Brief** — professional, self-explanatory
2. **Prep** — shorter, casual
3. **Briefing** — slightly more formal
4. **Update** — generic but clear

**Recommendation:** "Pre-Brief" for the feature, "clip" for individual recordings.

### Button labels
- "Add a clip" (host, to record)
- "Add another clip"
- "Watch pre-brief" (invitee, on notification)
- "Save clip" / "Re-record"
- "Join call" (unchanged)

### Empty states
- Host: "No pre-brief yet. Record a short update to prepare attendees before the call."
- Invitee: "No pre-brief for this meeting."

### Reminder notification (v1.5)
- Subject: "Pre-brief ready for your call with Oli"
- Body: "Oli shared 2 clips to watch before your call. Catch up so you're ready."
- CTA: "Watch pre-brief"

### Watched status labels
- "Watched" ✓
- "Partially watched"
- "Not yet watched"

### Pre-join prompts
- Invitee (clips available, unwatched): "Watch the pre-brief before joining — it's 2 minutes."
- Invitee (all watched): "You're all caught up."
- Host (some haven't watched): "2 of 4 attendees have watched the pre-brief."
- Host (all watched): "Everyone is prepared."

### Host readiness messages
- "Everyone is prepared" (all watched)
- "Waiting on 2 people" (partial)
- "No one has watched yet" (none)

---

## 13. Product Positioning

### Position 1: Internal teams / timezone collaboration
- **Target user:** Remote teams across 3+ time zones
- **Value prop:** "Stop scheduling meetings just to share updates. Record a 2-minute pre-brief and let your team watch when they come online."
- **Why they'd pay:** Reduces sync meetings by 30-50%. Saves hours per week for distributed teams. Competes with "just send a Loom" but is integrated into the meeting flow.

### Position 2: Agencies / consultancies preparing clients
- **Target user:** Agency PMs, consultants, account managers
- **Value prop:** "Brief your client before the meeting so you spend call time on decisions, not context-setting."
- **Why they'd pay:** Clients feel more prepared. Meetings are shorter and more productive. Differentiates from competitors. Premium feel.

### Position 3: General meeting acceleration
- **Target user:** Anyone tired of 30-minute meetings that could be 10 minutes
- **Value prop:** "Turn every meeting into a prepared meeting. Record what changed, share what matters, skip the recap."
- **Why they'd pay:** Measurable meeting time savings. Simple enough that adoption isn't a hurdle.

**Strongest position for V1:** Position 2 (agencies/consultancies). Clearest pain, highest willingness to pay, most concrete use case, and the host has strong motivation to record (impressing clients).

---

## 14. Critical Red-Team Section

### Why users may ignore pre-briefs
**Risk:** "I'll just explain it on the call" is the path of least resistance.
**Mitigation:** Make recording faster than typing a message. One tap → record → done. Under 20 seconds of friction. Show time-saved metrics to hosts.

### Why this may feel like Loom glued onto meetings
**Risk:** If the pre-brief feels like a separate step, it's dead.
**Mitigation:** The timeline lives *on* the meeting page, not a separate URL. Same link, same flow. The pre-brief is just the top section of the page you already visit.

### Why hosts may not want to record
**Risk:** Recording yourself is uncomfortable. Many people avoid video.
**Mitigation:** Support audio-only clips (v1.5). Keep it low-stakes: "just a quick update, not a presentation." Auto-title clips so there's no friction. No editing, no polish expected.

### Why invitees may not watch
**Risk:** "I'll just ask in the meeting."
**Mitigation:** Make clips short (max 3 min). Show total watch time upfront ("2 min pre-brief"). Subtle social pressure: host sees who watched. Don't block joining — that creates resentment.

### Adoption risks
**Risk:** Feature ships, nobody uses it.
**Mitigation:** Target Position 2 users (agencies) who have external accountability. Make it zero-config — no "enable pre-brief" toggle. The capability is just there on every meeting page.

### Cannibalization risks
**Risk:** If pre-briefs work too well, people stop having live calls (reducing engagement).
**Mitigation:** This is a *good* outcome. Fewer unnecessary meetings = happy users = retention. The live call still exists for when it's needed.

### Technical risks
**Risk:** Large video uploads on mobile, R2 costs, MediaRecorder browser support.
**Mitigation:** Cap at 3 min (≈30MB WebM). Use chunked/presigned uploads. MediaRecorder is supported in all modern browsers including mobile Safari 14.5+. Fallback gracefully.

---

## 15. Final Recommendation

### Ultra-minimal first version
Ship exactly this:
1. "Add a clip" button on `/{roomId}` → record webcam+audio → upload to R2 → show in timeline
2. Inline playback on the pre-join page with watched/not-watched tracking
3. Host sees readiness status next to participant peek avatars

That's it. Three capabilities. One new route (`/{roomId}/record`), one new API (`/api/clips`), one R2 bucket, and extensions to the existing DO and pre-join page.

### The 2-3 product bets that matter most
1. **Recording must be faster than typing.** If it takes more than 15 seconds to go from "I want to share something" to "recording," the feature dies. One tap, no configuration.
2. **The timeline must live on the meeting page, not a separate surface.** The moment you make someone navigate to a different place to consume the pre-brief, adoption drops to near zero.
3. **Watched status must create gentle social accountability.** The host seeing "Bob hasn't watched" is the entire adoption engine. Without it, there's no incentive for invitees to watch.

### What to avoid building too early
- Notifications / reminders (users don't have accounts yet)
- AI transcripts / summaries
- Threaded discussions on clips
- Screen recording
- Analytics dashboard
- Editing / trimming clips
- Separate "async meeting" mode

### Why this fits naturally inside a Zoom/Meet-style app
Every meeting app already has a pre-join page where you wait, configure your camera, and see who's there. The pre-brief is simply *content that appears on that page before you join*. It doesn't change navigation, doesn't add new concepts, doesn't require onboarding. It's just: "there are clips here, watch them, then join." The live meeting experience is completely untouched.

The adaptation is small. The leverage is high. The differentiation is real.
